/** @file Runs an independent allocator process for concurrent-start and abrupt-termination regression tests. */
import { selectDevelopmentPorts } from '../dev-ports';

const [root, commonDirectory] = process.argv.slice(2);
const lease = await selectDevelopmentPorts(root, {}, { commonDirectory, backend: 'local', mode: 'full' });
process.send?.(lease.ports);
process.on('message', () => {
  void lease.release().then(() => process.exit(0));
});
