// ON THE BEAT — what the relay says about its own load: one line when it starts, and one a minute while anyone is on it.
// Counts and sizes only, never a venue, an id or an address: a log is read by more people than a view is.
// scripts/load.mjs reads the same lines from the relay it starts, and docs/show-night.md says how to read them.

import { totalmem } from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { getHeapStatistics } from 'node:v8';

/** The event loop is looked at this often; what it reports includes this much, so a quiet loop is not read as lagging. */
export const LOOP_RESOLUTION_MS = 10;

const MB = 1048576;
const mb = (bytes) => Math.round(bytes / MB);
const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');

/**
 * The line a minute of load is said as: who is on, then cpu, how late the event loop ran, and memory: all of it, the
 * JavaScript heap, the buffers outside the heap (every clip and every frame being read), and of those buffers the clips held.
 */
export function formatLoad({ phones, bands, staff, venues, cpu, lagP99, lagMax, rss, heapUsed, heapLimit, buffers, clips }) {
  return 'load: ' + plural(phones, 'phone') + ', ' + plural(bands, 'band') + ', ' + staff + ' staff in ' + plural(venues, 'venue')
    + ' | cpu ' + Math.round(cpu) + '% | loop lag p99 ' + Math.round(lagP99) + ' ms, max ' + Math.round(lagMax) + ' ms'
    + ' | rss ' + mb(rss) + ' MB, heap ' + mb(heapUsed) + ' of ' + mb(heapLimit) + ' MB'
    + ', buffers ' + mb(buffers) + ' MB, clips ' + (clips / MB).toFixed(1) + ' MB';
}

const LOAD_LINE = /^load: (\d+) phones?, (\d+) bands?, (\d+) staff in (\d+) venues? \| cpu (\d+)% \| loop lag p99 (\d+) ms, max (\d+) ms \| rss (\d+) MB, heap (\d+) of (\d+) MB, buffers (\d+) MB, clips (\d+\.\d) MB$/;

/**
 * The numbers in a line formatLoad made, with memory in the MB it was said in, or null for any other line. For
 * scripts/load.mjs, so the rig and the relay cannot drift apart on what a load line says.
 */
export function parseLoad(line) {
  const m = LOAD_LINE.exec(line);
  if (!m) return null;
  const [phones, bands, staff, venues, cpu, lagP99, lagMax, rssMB, heapUsedMB, heapLimitMB, buffersMB, clipsMB] = m.slice(1).map(Number);
  return { phones, bands, staff, venues, cpu, lagP99, lagMax, rssMB, heapUsedMB, heapLimitMB, buffersMB, clipsMB };
}

/**
 * The line said once at start: the ceiling V8 puts on this process's heap and the memory the machine has. Every
 * capacity figure in docs/not-done.md came from a laptop; this is what the machine the relay really runs on allows.
 */
export function startLine({ heapLimit = getHeapStatistics().heap_size_limit, total = totalmem(), node = process.version } = {}) {
  return 'load: node ' + node + ', heap limit ' + mb(heapLimit) + ' MB on a machine with ' + mb(total) + ' MB';
}

/**
 * A reader of the process. Each `sample()` reports, over the time since the one before it (or since the meter began),
 * cpu as a percent of one core (past 100 when other threads work too), how late the event loop ran, and memory;
 * `stop()` lets the loop watcher go. Everything it reads is a parameter, so a test can move the numbers.
 */
export function createMeter({
  clock = () => performance.now(), cpuUsage = () => process.cpuUsage(), memoryUsage = () => process.memoryUsage(),
  heapStats = getHeapStatistics, histogram = monitorEventLoopDelay({ resolution: LOOP_RESOLUTION_MS }),
} = {}) {
  histogram.enable();
  let since = clock();
  let spent = cpuUsage();
  // The histogram holds nanoseconds between the loop's looks, so what is late is what is over the look's own interval.
  const late = (ns) => Math.max(0, ns / 1e6 - LOOP_RESOLUTION_MS);
  return {
    sample() {
      const at = clock();
      const cpu = cpuUsage();
      // Microseconds of cpu over milliseconds of the clock: a thousand of them to the millisecond, a hundred for a percent.
      const busy = (cpu.user - spent.user) + (cpu.system - spent.system);
      const heap = heapStats();
      const sample = {
        cpu: busy / ((at - since) * 10),
        lagP99: late(histogram.percentile(99)),
        lagMax: late(histogram.max),
        rss: memoryUsage().rss,
        buffers: memoryUsage().arrayBuffers,
        heapUsed: heap.used_heap_size,
        heapLimit: heap.heap_size_limit,
      };
      // Node's histogram records the gap between two looks, so the first one after a reset only starts its clock: a stall
      // in the few milliseconds after a sample goes unseen, one look in several thousand a minute.
      histogram.reset();
      since = at;
      spent = cpu;
      return sample;
    },
    stop() { histogram.disable(); },
  };
}
