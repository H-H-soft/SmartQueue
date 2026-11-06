// Estimate in service-duration batches. Busy desks become available next batch.
export function estimateWait(waitingAhead, desks, avgMinutes) {
  if (!desks.length) return null;
  const available = desks.filter((desk) => !desk.tickets.length).length;
  return Math.max(0, Math.ceil((waitingAhead + 1 - available) / desks.length)) * avgMinutes;
}
