// test/cluster-child.mjs: for the real kill test in run.mjs's db part. Starts a throwaway cluster (marker folder from OMNIKOM_TEST_MARKER_DIR),
// prints { port, dir, marker, pid } as ONE JSON line, then idles until it is killed. The test kills it hard (no handler runs) and then checks
// that sweepClusters() stops the cluster and removes its folder and marker.
import { startCluster } from './harness.mjs';

// stdout carries the one JSON line only; the harness's "trying P+1" lines go to stderr
const c = startCluster({ markerDir: process.env.OMNIKOM_TEST_MARKER_DIR || undefined, say: l => console.error(l) });
console.log(JSON.stringify({ port: c.port, dir: c.dir, marker: c.marker, pid: process.pid }));
setInterval(() => {}, 60000);
