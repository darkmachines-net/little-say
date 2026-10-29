/** @file Owns cancellable AI suggestions, latest-board context, scoped edits, and reviewable media for the shared editor. */

import { useEffect, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import { applyProposal, boardContext, defaultPicturePolicy, getLanguageProfile, MAX_AI_TURNS, mergeBoardSuggestion, proposalTranslationReplacements, reviseBoard, scopeBoardSuggestion, type Board, type BoardChanges, type BoardProposal, type BoardSuggestion, type ConversationTurn, type CreationDraft, type Settings } from '@little-say/core';
import { proposeBoard } from './api';
import { prepareProposalPictures, type PictureTileState } from './pictures';

/** Keep AI optional and confined to a staged suggestion; newer manual edits are merged only after review. */
export function useBoardAssistant({ board, settings, draft, onConsent, onAccept, onDraft, onSpeechReady }: {
  board: Board; settings: Settings; draft?: CreationDraft;
  /** Persist explicit AI use before sending board words. */
  onConsent: () => Promise<void>;
  /** Durably merge against the latest saved board, rejecting unreviewed conflicts. */
  onAccept: (suggestion: BoardSuggestion, choice?: 'current' | 'suggested') => Promise<void>;
  /** Persist a new-board session without adding it to the playable library. */
  onDraft: (state: Pick<CreationDraft, 'prompt' | 'suggestion'>) => void;
  /** Reload verified speech files when preparation makes them available. */
  onSpeechReady: () => Promise<void>;
}) {
  const [prompt, setPrompt] = useState(draft?.prompt ?? '');
  const [suggestion, setSuggestion] = useState<BoardSuggestion | null>(draft?.suggestion ?? null);
  const [scope, setScope] = useState<string | null>(null);
  const [history, setHistory] = useState<ConversationTurn[]>([]);
  const [reply, setReply] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'generate' | 'save' | null>(null);
  const [progress, setProgress] = useState('');
  const [states, setStates] = useState<Record<string, PictureTileState>>({});
  const [translations, setTranslations] = useState<ReturnType<typeof proposalTranslationReplacements>>([]);
  const translationCandidate = useRef<Board | null>(null);
  const request = useRef<AbortController | null>(null);
  const live = useRef(true);
  const latest = useRef({ board, suggestion, onDraft }); latest.current = { board, suggestion, onDraft };
  useEffect(() => { live.current = true; return () => { live.current = false; request.current?.abort(); }; }, []);
  useEffect(() => { latest.current.onDraft({ prompt, suggestion }); }, [draft?.board.id, prompt, suggestion]);
  let preview = board;
  let conflicts: string[] = [];
  let mergeError = '';
  if (suggestion) {
    try { const merged = mergeBoardSuggestion(suggestion.base, suggestion.board, board); preview = { ...merged.board, revision: Math.max(merged.board.revision, suggestion.board.revision) }; conflicts = merged.conflicts; }
    catch { preview = suggestion.board; mergeError = 'This suggestion no longer fits the current board. Dismiss it and try again.'; }
  }
  const stop = () => { const active = request.current; request.current = null; active?.abort(); setBusy(null); setProgress(''); setStates({}); };
  const clear = () => { stop(); setSuggestion(null); setReply(''); setError(''); setTranslations([]); };
  const edit = (changes: BoardChanges) => {
    stop(); setTranslations([]); translationCandidate.current = null;
    const next = reviseBoard(preview, changes);
    setSuggestion({ base: suggestion?.base ?? board, board: next });
    return next;
  };
  const generate = async () => {
    const message = prompt.trim();
    if (!message || request.current || busy === 'save') return;
    const controller = new AbortController(); request.current = controller;
    const source = preview.tiles.length ? preview : undefined;
    const base = board;
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
      setSuggestion(previous => ({ base, board: { ...candidate, revision: Math.max(candidate.revision, (previous?.board.revision ?? board.revision) + 1) } }));
    };
    setBusy('generate'); setError(''); setReply(''); setProgress(''); setStates({}); setTranslations([]);
    try {
      if (!settings.aiConsent) await onConsent();
      if (controller.signal.aborted) return;
      const response = await proposeBoard(settings.backendUrl, {
        prompt: selected ? `Change only card ${selected}. Keep all other cards, order, title and board settings unchanged. ${message}` : message,
        board: source ? boardContext(source) : null, languageProfile: getLanguageProfile(settings),
        picturePolicy: preview.picturePolicy ?? settings.pictureDefaults ?? defaultPicturePolicy, pictureCapability: 1,
        conversation: { history: history.slice(-(MAX_AI_TURNS - 1)), draft: null },
      }, controller.signal);
      if (!live.current || request.current !== controller) return;
      if (response.boardId !== (source?.id ?? null) || response.baseRevision !== (source?.revision ?? null)) throw new Error('This reply refers to a different board. Please try again.');
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
    } catch (e) { if (live.current && request.current === controller) { setError((e as Error).message); setPrompt(value => value || message); } }
    finally { if (live.current && request.current === controller) { request.current = null; setBusy(null); setStates({}); } }
  };
  const accept = async (choice?: 'current' | 'suggested') => {
    if (!suggestion || busy === 'save') return;
    stop(); setBusy('save'); setError('');
    try { await onAccept(suggestion, choice); setSuggestion(null); setTranslations([]); setReply(''); }
    catch (e) { setError((e as Error).message); }
    finally { if (live.current) setBusy(null); }
  };
  const useTranslations = () => {
    stop();
    if (translationCandidate.current && suggestion) setSuggestion({ ...suggestion, board: { ...suggestion.board, tiles: suggestion.board.tiles.map(tile => ({ ...tile, translations: translationCandidate.current!.tiles.find(value => value.id === tile.id)?.translations ?? tile.translations })) } });
    setTranslations([]);
  };
  return { prompt, setPrompt, suggestion, preview, scope, setScope, reply, error, mergeError, busy, progress, states, conflicts, translations, useTranslations, generate, accept, stop, clear, edit };
}
