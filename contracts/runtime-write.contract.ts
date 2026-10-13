// Successful runtime writes must remain inside the real project root.
// Rejection and absence of side effects are paired CLI regression cases.
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';

export default {
  post: (result: string, projectDir: string, _runtimeFile: string, text: string): true | string => {
    const path = relative(realpathSync(projectDir), realpathSync(result));
    if (path === '..' || path.startsWith('..' + sep) || isAbsolute(path)) return 'runtime write escaped project';
    return readFileSync(result, 'utf8') === text || 'runtime content differs';
  },
};
