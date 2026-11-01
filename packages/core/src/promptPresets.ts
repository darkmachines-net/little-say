/** @file Loads client-safe starter concepts and the onboarding request template. */

import onboarding from '../../../prompts/shared/onboarding.json' with { type: 'json' };
import { loadPromptResource, loadPromptTemplate } from './promptResources';

export const starterConcepts = loadPromptResource(onboarding, ['farm', 'everyday', 'family', 'template'], 'shared/onboarding');
/** Render the starter request with the caller's concept list left literal. */
export const starterPromptText = loadPromptTemplate(starterConcepts.template, ['concepts'], 'shared/onboarding.template');
