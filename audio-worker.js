importScripts("audio-codec.js?v=1.1.5");

let acc = new Float32Array(0);
let lastScan = 0;
let busy = false;
const seen = [];

function remember(bytes) {
    const key = Array.prototype.join.call(bytes, ",");
    if (seen.indexOf(key) !== -1) return false;
    seen.push(key);
    if (seen.length > 6) seen.shift();
    return true;
}

onmessage = function (e) {
    const msg = e.data || {};
    if (msg.type === "encode") {
        const pcm = AudioCodec.encodePacket(msg.bytes);
        postMessage({ type: "pcm", pcm: pcm }, [pcm.buffer]);
        return;
    }
    if (msg.type !== "mic" || !msg.samples) return;
    const chunk = new Float32Array(msg.samples);
    const next = new Float32Array(acc.length + chunk.length);
    next.set(acc);
    next.set(chunk, acc.length);
    acc = next;
    const cap = Math.round(44100 * 3.2);
    if (acc.length > cap) {
        const drop = acc.length - Math.round(44100 * 2.6);
        acc = new Float32Array(acc.subarray(drop));
        lastScan = Math.max(0, lastScan - drop);
    }
    if (busy || acc.length - lastScan < 44100 * 0.3) return;
    busy = true;
    let packets = [];
    try {
        packets = AudioCodec.decodeAll(acc);
    } catch (err) {
        packets = [];
    }
    lastScan = acc.length;
    busy = false;
    const fresh = [];
    for (let i = 0; i < packets.length; i++) {
        if (remember(packets[i])) fresh.push(packets[i]);
    }
    if (fresh.length) postMessage({ type: "packets", packets: fresh });
};
