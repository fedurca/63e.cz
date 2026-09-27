importScripts("audio-codec.js?v=1.1.6");

let acc = new Float32Array(0);
let busy = false;

onmessage = function (e) {
    const msg = e.data || {};
    if (msg.type === "reset") {
        acc = new Float32Array(0);
        return;
    }
    if (msg.type !== "mic" || !msg.samples) return;
    const chunk = new Float32Array(msg.samples);
    const next = new Float32Array(acc.length + chunk.length);
    next.set(acc);
    next.set(chunk, acc.length);
    acc = next;
    const cap = Math.round(44100 * 0.55);
    if (acc.length > cap) acc = new Float32Array(acc.subarray(acc.length - cap));
    if (busy || acc.length < 44100 * 0.22) return;
    busy = true;
    let result = null;
    try { result = AudioCodec.decodeAll(acc); }
    catch (err) { result = null; }
    busy = false;
    if (!result) return;
    postMessage({
        type: "heard",
        rms: result.rms,
        banks: result.banks.map(function (b) {
            return { bank: b.bank, name: b.name, energy: b.energy, symbols: b.symbols, at: b.at };
        })
    });
};
