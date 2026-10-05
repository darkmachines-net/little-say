/** @file Keeps native AI routing on the configured server; hosted ChatGPT connections currently belong to the browser. */

/** Native installations do not share the website's HttpOnly ChatGPT session. */
export function prefersChatGpt(_server: string): boolean { return false; }
/** Browser-only billing selection has no native persistence or credential side effects. */
export function rememberChatGpt(_server: string, _selected: boolean): void {}
