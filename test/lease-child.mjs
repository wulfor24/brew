// a stand-in worker process for the lease test: says "leader" once it holds the background lease
process.env.ROLE = 'worker';
const { startLease, whenLeader } = await import('../roles.js');
whenLeader(() => console.log('leader'));
await startLease({ everyMs: 300, log: { log() {}, warn() {} } });
setInterval(() => {}, 1e9);
