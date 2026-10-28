/*
 * k6's end-of-test summary as the harness keeps it: the whole summary as JSON
 * in the run's folder for report.mjs, and one line on stdout.
 */

/**
 * @param {string} phase
 */
export function summaryWriter(phase) {
  return (data) => {
    const failed = Object.entries(data.metrics)
      .flatMap(([name, metric]) =>
        Object.entries(metric.thresholds || {})
          .filter(([, threshold]) => !threshold.ok)
          .map(([expression]) => `${name} ${expression}`),
      )
      .sort();
    const line =
      failed.length === 0
        ? `k6 ${phase}: every threshold held\n`
        : `k6 ${phase}: ${failed.length} thresholds failed:\n  ${failed.join("\n  ")}\n`;
    return { [`/out/${phase}.summary.json`]: JSON.stringify(data), stdout: line };
  };
}
