/** @file Loads only client-safe starter concepts/templates and distinct conversation preset messages. */

import onboarding from '../../../prompts/shared/onboarding.json';
import conversation from '../../../prompts/shared/conversation.json';
import { loadPromptResource, loadPromptTemplate } from './promptResources';

export const starterConcepts = loadPromptResource(onboarding, ['farm', 'everyday', 'family', 'template'], 'shared/onboarding');
export const conversationPrompts = loadPromptResource(conversation, ['farm', 'snack', 'family'], 'shared/conversation');
/** Render the starter request with the caller's concept list left literal. */
export const starterPromptText = loadPromptTemplate(starterConcepts.template, ['concepts'], 'shared/onboarding.template');
