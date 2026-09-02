let admissionOpen = true;
const inFlight = new Set<Promise<void>>();

export function isApplicationAdmissionOpen(): boolean {
  return admissionOpen;
}

export function closeApplicationAdmission(): void {
  admissionOpen = false;
}

export function openApplicationAdmission(): void {
  admissionOpen = true;
}

/** Tracks host requests so shutdown can wait before closing SQLite handles. */
export function trackApplicationRequest<T>(request: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const completed = new Promise<void>((resolve) => {
    release = resolve;
  });
  inFlight.add(completed);
  return Promise.resolve()
    .then(request)
    .finally(() => {
      inFlight.delete(completed);
      release();
    });
}

export async function waitForApplicationRequests(): Promise<void> {
  while (inFlight.size > 0) {
    await Promise.allSettled([...inFlight]);
  }
}
