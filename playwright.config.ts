/** @file Isolates independent PR6 browser QA from other ZBook servers without changing maintained configuration. */
import config from '../../playwright.config';
import { resolve } from 'node:path';
export default {...config,testDir:resolve('tests/web'),outputDir:resolve('artifacts/qa/browser-results'),use:{...config.use,baseURL:'http://127.0.0.1:43167'},webServer:{...config.webServer,command:'npm run start',cwd:process.cwd(),url:'http://127.0.0.1:43167/api/health',env:{PORT:'43167',HOST:'127.0.0.1',ALLOWED_ORIGINS:'http://127.0.0.1:43167',AAC_OPENAI_KEY:'',OPENAI_API_KEY:''}}};
