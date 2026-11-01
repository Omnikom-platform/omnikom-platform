// test/cluster-child.mjs: for the real kill test in run.mjs's db part. Starts a throwaway cluster (marker folder from OMNIKOM_TEST_MARKER_DIR),
// prints { port, dir, marker, pid } as ONE JSON line, then idles until it is killed. The test kills it hard (no handler runs) and then checks
// that sweepClusters() stops the cluster and removes its folder and marker.
import { startCluster } from './harness.mjs';

const c = startCluster({ markerDir: process.env.OMNIKOM_TEST_MARKER_DIR || undefined });
console.log(JSON.stringify({ port: c.port, dir: c.dir, marker: c.marker, pid: process.pid }));
setInterval(() => {}, 60000);
