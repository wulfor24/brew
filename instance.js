// This process's id among all instances: one random id per process (Cloud Run reports the same hostname and PID 1 in every
// container, so hostname:pid can't tell two instances apart). Used by jobs, the bus and build progress.
import crypto from 'node:crypto';
export const ME = `${process.env.K_REVISION || 'local'}:${crypto.randomUUID().slice(0, 12)}`;
