importScripts('physics.js');
onmessage = (ev) => { const { P, mode, id } = ev.data; postMessage({ id, op: PT.runSlim(P, mode) }); };
