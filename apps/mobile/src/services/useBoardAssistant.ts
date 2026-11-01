/** @file Shows live word/picture progress and applies AI turns through cancellable previews and durable, recoverable board commits. */

import { useEffect, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import { applyProposal, boardContext, defaultPicturePolicy, getLanguageProfile, MAX_AI_TURNS, mergeBoardSuggestion, proposalTranslationReplacements, reviseBoard, scopeBoardSuggestion, tileSource, type Board, type BoardChanges, type BoardProposal, type BoardSuggestion, type ConversationTurn, type CreationDraft, type Settings } from '@little-say/core';
import { proposeBoard } from './api';
import { prepareProposalPictures, type PictureTileState } from './pictures';

/**
 * Show words before media, report observed stages, then commit the turn as one normal board Undo step.
 * Stopping or directly editing a preview saves its usable state and cancels remaining media work.
 * Only conflicting edits or a failed write pause application; their preview and retry text stay visible.
 */
export function useBoardAssistant({ board, settings, draft, onConsent, onAccept, onDraft, onSpeechReady }: {
  board: Board; settings: Settings; draft?: CreationDraft;
  /** Persist explicit AI use before sending board words. */
  onConsent: () => Promise<void>;
  /** Durably merge against the latest saved board and record one normal Undo step; reject unresolved conflicts. */
  onAccept: (suggestion: BoardSuggestion, choice?: 'current' | 'suggested') => Promise<void>;
  /** Update the in-memory creation session; only an explicit exit choice persists it. */
  onDraft: (state: Pick<CreationDraft, 'prompt' | 'suggestion' | 'history' | 'reply'>) => void;
  /** Reload verified speech files when preparation makes them available. */
  onSpeechReady: () => Promise<void>;
}) {
  const [prompt, setPrompt] = useState(draft?.prompt ?? '');
  const [suggestion, setSuggestion] = useState<BoardSuggestion | null>(draft?.suggestion ?? null);
  const [scope, setScope] = useState<string | null>(null);
  const [history, setHistory] = useState<ConversationTurn[]>(draft?.history ?? []);
  const [reply, setReply] = useState(draft?.reply ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'generate' | 'save' | null>(null);
  const [progress, setProgress] = useState('');
  const [states, setStates] = useState<Record<string, PictureTileState>>({});
  const [translations, setTranslations] = useState<ReturnType<typeof proposalTranslationReplacements>>([]);
  const translationCandidate = useRef<Board | null>(null);
  const request = useRef<AbortController | null>(null);
  const writing = useRef(false);
  const live = useRef(true);
  const latest = useRef({ board, suggestion, onDraft, onAccept }); latest.current = { board, suggestion, onDraft, onAccept };
  useEffect(() => { live.current = true; return () => { live.current = false; request.current?.abort(); }; }, []);
  useEffect(() => {
    // A queued optimistic draft snapshot must not overwrite the durable AI commit in progress.
    if (!writing.current && busy !== 'save') latest.current.onDraft({ prompt, suggestion, history, reply });
  }, [draft?.board.id, prompt, suggestion, history, reply, busy]);
  let preview = board;
  let conflicts: string[] = [];
  let mergeError = '';
  if (suggestion) {
    try { const merged = mergeBoardSuggestion(suggestion.base, suggestion.board, board); preview = { ...merged.board, revision: Math.max(merged.board.revision, suggestion.board.revision) }; conflicts = merged.conflicts; }
    catch { preview = suggestion.board; mergeError = 'These changes no longer fit the saved board. Adjust the cards before retrying the save.'; }
  }
  const cancel = () => { const active = request.current; request.current = null; active?.abort(); setBusy(null); setProgress(''); setStates({}); };
  const apply = async (candidate: BoardSuggestion, choice?: 'current' | 'suggested') => {
    if (writing.current) return false;
    setSuggestion(candidate);
    try {
      if (!choice && mergeBoardSuggestion(candidate.base, candidate.board, latest.current.board).conflicts.length) { setBusy(null); return false; }
      writing.current = true; setBusy('save'); setError('');
      await latest.current.onAccept(candidate, choice);
      if (live.current) { setSuggestion(null); setReply(''); }
      return true;
    } catch (e) { if (live.current) setError((e as Error).message); return false; }
    finally { writing.current = false; if (live.current) setBusy(null); }
  };
  const recovered = useRef(draft?.suggestion ?? null);
  const applyRef = useRef(apply); applyRef.current = apply;
  useEffect(() => {
    const candidate = recovered.current; recovered.current = null;
    if (candidate) void applyRef.current(candidate);
  }, []);
  const stop = async () => { const pending = latest.current.suggestion; cancel(); return pending ? apply(pending) : true; };
  const clear = () => { cancel(); setSuggestion(null); setReply(''); setError(''); setTranslations([]); };
  const edit = (changes: BoardChanges) => {
    cancel(); setTranslations([]); translationCandidate.current = null;
    const next = reviseBoard(preview, changes);
    void apply({ base: suggestion?.base ?? board, board: next });
    return next;
  };
  const generate = async () => {
    const message = prompt.trim();
    if (!message || request.current || writing.current || suggestion) return;
    const controller = new AbortController(); request.current = controller;
    const source = preview.tiles.length ? preview : undefined;
    const base = board;
    let pending: BoardSuggestion | null = null;
    const selected = preview.tiles.find(tile => tile.id === scope)?.id ?? null;
    const ids: string[] = [];
    // Allocate once per response so picture updates and direct edits keep stable tile identities.
    const stableMaterialize = (envelope: BoardProposal, replaceTranslations = false) => {
      let index = 0;
      const candidate = applyProposal(source ?? null, envelope, () => { const slot = index++; return ids[slot] ?? (ids[slot] = Crypto.randomUUID()); }, undefined, replaceTranslations);
      return scopeBoardSuggestion(source ?? board, { ...candidate, id: board.id, createdAt: board.createdAt }, selected);
    };
    const publish = (envelope: BoardProposal) => {
      if (!live.current || request.current !== controller) return;
      const candidate = stableMaterialize(envelope);
      pending = { base, board: candidate };
      setSuggestion(previous => ({ base, board: { ...candidate, revision: Math.max(candidate.revision, (previous?.board.revision ?? board.revision) + 1) } }));
    };
    setBusy('generate'); setError(''); setReply(''); setProgress('Connecting to AI…'); setStates({}); setTranslations([]);
    try {
      if (!settings.aiConsent) await onConsent();
      if (controller.signal.aborted) return;
      const response = await proposeBoard(settings.backendUrl, {
        prompt: selected ? `Change only card ${selected}. Keep all other cards, order, title and board settings unchanged. ${message}` : message,
        board: source ? boardContext(source) : null, languageProfile: getLanguageProfile(settings),
        picturePolicy: preview.picturePolicy ?? settings.pictureDefaults ?? defaultPicturePolicy, pictureCapability: 1,
        conversation: { history: history.slice(-(MAX_AI_TURNS - 1)), draft: null },
      }, controller.signal, value => { if (live.current && request.current === controller) setProgress(value); });
      if (!live.current || request.current !== controller) return;
      if (response.boardId !== (source?.id ?? null) || response.baseRevision !== (source?.revision ?? null)) throw new Error('This reply refers to a different board. Please try again.');
      setProgress('');
      setHistory(old => [...old.slice(-(MAX_AI_TURNS - 2)), { prompt: message, reply: response.proposal.explanation }]);
      setPrompt(value => value.trim() === message ? '' : value);
      if (response.proposal.needsClarification) { setReply(response.proposal.explanation); return; }
      // Validate before starting media; no local photo bytes/paths are sent with boardContext.
      stableMaterialize(response);
      const replacements = proposalTranslationReplacements(source, response);
      setTranslations(replacements);
      if (replacements.length) translationCandidate.current = stableMaterialize(response, true);
      if (!response.preparation) publish(response);
      if (response.proposal.picturePolicy) {
        const prepared = await prepareProposalPictures(source, response, { ...settings, aiConsent: true }, {
          signal: controller.signal,
          speechReady: onSpeechReady,
          progress: value => { if (request.current === controller) setProgress(value); },
          tileProgress: (id, state) => { const match = /^draft-(\d+)$/.exec(id); const key = match ? ids[Number(match[1])] ?? id : id; if (request.current === controller) setStates(old => ({ ...old, [key]: state })); },
          preview: value => publish({ ...response, pictures: value.tiles.map((tile, index) => ({ index, illustration: tile.illustration, concept: tile.pictureConcept })) }),
        });
        if (request.current !== controller) return;
        publish(prepared.proposal); setProgress(prepared.issues.join(' '));
      }
      if (pending && request.current === controller && !await apply(pending)) setPrompt(value => value || message);
    } catch (e) {
      if (live.current && request.current === controller) {
        setProgress('');
        if (pending) await apply(pending);
        setError((e as Error).message); setPrompt(value => value || message);
      }
    }
    finally { if (live.current && request.current === controller) { request.current = null; setBusy(null); setStates({}); } }
  };
  const accept = async (choice?: 'current' | 'suggested') => {
    if (!latest.current.suggestion || writing.current) return;
    const pending = latest.current.suggestion; cancel(); await apply(pending, choice);
  };
  const useTranslations = async () => {
    const candidate = translationCandidate.current, current = latest.current.board;
    if (!candidate || writing.current || latest.current.suggestion) return;
    const replacements = new Set(translations.map(value => value.tileId));
    if (current.tiles.some(tile => replacements.has(tile.id) && tileSource(tile) !== tileSource(candidate.tiles.find(value => value.id === tile.id)!))) { setError('Card words changed. Ask AI again before replacing their translations.'); return; }
    const next = { ...current, tiles: current.tiles.map(tile => ({ ...tile, translations: replacements.has(tile.id) ? candidate.tiles.find(value => value.id === tile.id)?.translations ?? tile.translations : tile.translations })) };
    if (await apply({ base: current, board: next })) { setTranslations([]); translationCandidate.current = null; }
  };
  return { prompt, setPrompt, suggestion, preview, scope, setScope, history, reply, error, mergeError, busy, progress, states, conflicts, translations, useTranslations, generate, accept, stop, clear, edit };
}
