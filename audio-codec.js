// Morse. Each id's first character picks one of 36 tones. The receiver scans all of them.
(function (root) {
    const SR = 44100;
    const CHARS = "0123456789abcdefghijklmnopqrstuvwxyz";
    const WIN = Math.round(SR / 110);
    const DF = SR / WIN;
    const FREQS = [];
    for (let i = 0; i < CHARS.length; i++) FREQS.push(400 + i * DF);
    const UNIT = 0.015;
    const HOP = Math.round(SR * 0.002);
    const HOP_MS = HOP / SR * 1000;
    const CODE = {
        A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.", G: "--.", H: "....",
        I: "..", J: ".---", K: "-.-", L: ".-..", M: "--", N: "-.", O: "---", P: ".--.",
        Q: "--.-", R: ".-.", S: "...", T: "-", U: "..-", V: "...-", W: ".--", X: "-..-",
        Y: "-.--", Z: "--..",
        0: "-----", 1: ".----", 2: "..---", 3: "...--", 4: "....-", 5: ".....",
        6: "-....", 7: "--...", 8: "---..", 9: "----."
    };
    const REV = {};
    Object.keys(CODE).forEach(function (ch) { REV[CODE[ch]] = ch; });

    function plain(text) {
        return String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
    }
    function idToken(id) {
        return plain(id).replace(/[^A-Z0-9]/g, "").slice(0, 6).padEnd(4, "X");
    }
    function poseMessage(id, pose) {
        const x = Math.max(0, Math.round((pose && pose.x) || 0));
        const y = Math.max(0, Math.round((pose && pose.y) || 0));
        const hp = Math.max(0, Math.round((pose && pose.hp) || 0));
        const lvl = Math.max(0, Math.round((pose && pose.lvl) || 0));
        return "VV" + idToken(id) + "P" + x + "X" + y + "H" + hp + "L" + lvl + "K";
    }
    function chatMessage(id, text) {
        const body = plain(text).replace(/[^A-Z0-9 ]/g, " ").replace(/ +/g, " ").trim().slice(0, 40);
        if (!body) return "";
        return "VV" + idToken(id) + "C" + body + "K";
    }

    function freqForId(id) {
        const ch = String(id || "").toLowerCase().replace(/[^0-9a-z]/g, "").charAt(0) || "0";
        const i = Math.max(0, CHARS.indexOf(ch));
        return FREQS[i];
    }
    function charForFreq(freq) {
        let best = 0;
        let err = 1e9;
        for (let i = 0; i < FREQS.length; i++) {
            const d = Math.abs(FREQS[i] - freq);
            if (d < err) { err = d; best = i; }
        }
        return CHARS.charAt(best);
    }

    function encodeMorse(text, freq) {
        const unit = Math.round(SR * UNIT);
        const events = [];
        const src = String(text || "");
        for (let c = 0; c < src.length; c++) {
            const ch = src[c];
            if (ch === " ") {
                events.push({ on: false, n: unit * 4 });
                continue;
            }
            const pat = CODE[ch];
            if (!pat) continue;
            for (let i = 0; i < pat.length; i++) {
                events.push({ on: true, n: unit * (pat[i] === "-" ? 3 : 1) });
                events.push({ on: false, n: unit * 2 });
            }
            events.push({ on: false, n: unit * 3 });
        }
        events.push({ on: false, n: unit * 6 });
        let total = 0;
        for (let i = 0; i < events.length; i++) total += events[i].n;
        const out = new Float32Array(total);
        let at = 0;
        const fade = Math.max(8, Math.round(SR * 0.0015));
        for (let e = 0; e < events.length; e++) {
            const ev = events[e];
            if (ev.on) {
                for (let i = 0; i < ev.n; i++) {
                    let g = 0.42;
                    if (i < fade) g *= i / fade;
                    if (i > ev.n - fade) g *= (ev.n - i) / fade;
                    out[at + i] = g * Math.sin(2 * Math.PI * freq * (at + i) / SR);
                }
            }
            at += ev.n;
        }
        return out;
    }

    function goertzel(samples, offset, freq) {
        const w = 2 * Math.PI * freq / SR;
        const coeff = 2 * Math.cos(w);
        let s0 = 0, s1 = 0, s2 = 0;
        for (let i = 0; i < WIN; i++) {
            const x = samples[offset + i] || 0;
            s0 = x + coeff * s1 - s2;
            s2 = s1;
            s1 = s0;
        }
        return (s1 * s1 + s2 * s2 - coeff * s1 * s2) / (WIN * WIN);
    }

    function makeSlot() {
        return {
            floor: 1e-8, hot: false, run: 0, morse: "", text: "",
            packets: [], marks: 0, letters: 0, letterDone: false, spans: []
        };
    }

    function finishLetter(slot) {
        if (!slot.morse) return;
        const ch = REV[slot.morse] || "";
        slot.morse = "";
        if (!ch) return;
        slot.text += ch;
        slot.letters++;
        const vv = slot.text.lastIndexOf("VV");
        if (vv > 0) slot.text = slot.text.slice(vv);
        else if (slot.text.length > 48) slot.text = "";
        pullPackets(slot);
    }

    function lastMatch(re, text) {
        const flags = re.flags.indexOf("g") >= 0 ? re.flags : re.flags + "g";
        const all = text.matchAll(new RegExp(re.source, flags));
        let found = null;
        for (const m of all) found = m;
        return found;
    }

    function pullPackets(slot) {
        const t = slot.text;
        const pose = lastMatch(/VV([A-Z0-9]{4,8})P(\d+)X(\d+)H(\d+)L(\d+)K/, t);
        const chat = lastMatch(/([A-Z0-9]{6})C([A-Z0-9 ]{1,40})K/, t);
        let end = 0;
        if (pose) {
            slot.packets.push({
                kind: "pose", id: pose[1].toLowerCase(),
                x: +pose[2], y: +pose[3], hp: +pose[4], lvl: +pose[5]
            });
            end = Math.max(end, pose.index + pose[0].length);
        }
        if (chat && (!pose || chat.index >= pose.index)) {
            slot.packets.push({ kind: "chat", id: chat[1].toLowerCase(), text: chat[2].trim() });
            end = Math.max(end, chat.index + chat[0].length);
        }
        if (end) slot.text = t.slice(end);
    }

    function hopSlot(slot, hot) {
        const unitMs = UNIT * 1000;
        const ms = slot.run * HOP_MS;
        if (hot === slot.hot) {
            slot.run++;
            if (!hot && !slot.letterDone && ms >= unitMs * 3) {
                finishLetter(slot);
                slot.letterDone = true;
            }
            if (!hot && ms >= 500) {
                slot.morse = "";
                slot.text = "";
            }
            return;
        }
        if (slot.hot) {
            slot.spans.push(Math.round(ms));
            if (slot.spans.length > 12) slot.spans.shift();
            if (ms >= unitMs * 0.25 && ms < unitMs * 2) slot.morse += ".";
            else if (ms >= unitMs * 2 && ms < unitMs * 5) slot.morse += "-";
            slot.marks++;
        } else if (ms > 20) {
            slot.spans.push(-Math.round(ms));
            if (slot.spans.length > 12) slot.spans.shift();
        }
        slot.hot = hot;
        slot.run = 1;
        slot.letterDone = false;
    }

    function cancelOwn(mic, tx, hint) {
        if (!mic || !tx || mic.length < 32 || tx.length < 32) return { out: mic, lag: 0, gain: 0 };
        const wide = Math.min(Math.round(SR * 0.2), Math.floor(tx.length / 2), mic.length - 1);
        const tight = Math.round(SR * 0.004);
        const minL = hint == null ? -wide : Math.max(-wide, hint - tight);
        const maxL = hint == null ? wide : Math.min(wide, hint + tight);
        const maxLag = Math.max(Math.abs(minL), Math.abs(maxL));
        const span = Math.min(mic.length - maxLag, tx.length - maxLag, Math.round(SR * 0.06));
        if (span < 32) return { out: mic, lag: 0, gain: 0 };
        let best = 0;
        let lag = hint || 0;
        for (let L = minL; L <= maxL; L += 4) {
            let c = 0;
            const mic0 = L >= 0 ? L : 0;
            const tx0 = L >= 0 ? 0 : -L;
            for (let i = 0; i < span; i += 4) c += mic[mic0 + i] * tx[tx0 + i];
            if (c > best) { best = c; lag = L; }
        }
        const from = Math.max(minL, lag - 3);
        const to = Math.min(maxL, lag + 3);
        for (let L = from; L <= to; L++) {
            let c = 0;
            const mic0 = L >= 0 ? L : 0;
            const tx0 = L >= 0 ? 0 : -L;
            for (let i = 0; i < span; i += 2) c += mic[mic0 + i] * tx[tx0 + i];
            if (c > best) { best = c; lag = L; }
        }
        const mic0 = lag >= 0 ? lag : 0;
        const tx0 = lag >= 0 ? 0 : -lag;
        const n = Math.min(mic.length - mic0, tx.length - tx0);
        let dot = 0;
        let te = 0;
        for (let i = 0; i < n; i += 2) {
            dot += mic[mic0 + i] * tx[tx0 + i];
            te += tx[tx0 + i] * tx[tx0 + i];
        }
        const gain = te > 1e-10 ? Math.max(0, Math.min(1.8, dot / te)) : 0;
        if (gain < 0.03) return { out: mic, lag: lag, gain: 0 };
        const out = new Float32Array(mic.length);
        out.set(mic);
        for (let i = 0; i < n; i++) out[mic0 + i] -= gain * tx[tx0 + i];
        let before = 0;
        let after = 0;
        for (let i = 0; i < n; i += 4) {
            before += mic[mic0 + i] * mic[mic0 + i];
            after += out[mic0 + i] * out[mic0 + i];
        }
        if (after > before * 0.92) return { out: mic, lag: lag, gain: 0 };
        return { out: out, lag: lag, gain: gain };
    }

    function createListener() {
        let acc = new Float32Array(0);
        let done = 0;
        const slots = FREQS.map(function (freq, i) {
            const slot = makeSlot();
            slot.freq = freq;
            slot.ch = CHARS.charAt(i);
            slot.e = 0;
            slot.snr = 0;
            return slot;
        });
        const coeffs = FREQS.map(function (freq) { return 2 * Math.cos(2 * Math.PI * freq / SR); });

        function energy(offset, coeff) {
            let s0 = 0, s1 = 0, s2 = 0;
            for (let i = 0; i < WIN; i++) {
                const x = acc[offset + i] || 0;
                s0 = x + coeff * s1 - s2;
                s2 = s1;
                s1 = s0;
            }
            return (s1 * s1 + s2 * s2 - coeff * s1 * s2) / (WIN * WIN);
        }

        function push(samples) {
            if (!samples || !samples.length) return;
            const next = new Float32Array(acc.length + samples.length);
            next.set(acc);
            next.set(samples, acc.length);
            acc = next;
            const cap = SR * 6;
            if (acc.length > cap) {
                const drop = acc.length - Math.round(SR * 4);
                acc = new Float32Array(acc.subarray(drop));
                done = Math.max(0, done - drop);
            }
            const e = new Float32Array(FREQS.length);
            while (done + WIN <= acc.length) {
                for (let i = 0; i < FREQS.length; i++) e[i] = energy(done, coeffs[i]);
                for (let i = 0; i < FREQS.length; i++) {
                    const slot = slots[i];
                    const left = i > 0 ? e[i - 1] : 0;
                    const right = i < FREQS.length - 1 ? e[i + 1] : 0;
                    const side = Math.max(left, right, 1e-12);
                    slot.e = slot.e * 0.75 + e[i] * 0.25;
                    slot.snr = e[i] / side;
                    if (!slot.hot && slot.snr < 3) slot.floor = slot.floor * 0.9 + e[i] * 0.1;
                    const minE = 2e-6;
                    const hot = e[i] > minE && (slot.hot
                        ? (e[i] > slot.floor * 3 && slot.snr > 3)
                        : (e[i] > slot.floor * 6 && slot.snr > 8));
                    hopSlot(slot, hot);
                }
                done += HOP;
            }
        }

        function forget(freq) {
            for (let i = 0; i < slots.length; i++) {
                if (Math.abs(slots[i].freq - freq) > 20) continue;
                const slot = slots[i];
                slot.morse = "";
                slot.text = "";
                slot.hot = false;
                slot.run = 0;
                slot.letterDone = false;
                slot.packets = [];
            }
        }

        function poll() {
            const packets = [];
            const bands = [];
            for (let i = 0; i < slots.length; i++) {
                const slot = slots[i];
                for (let p = 0; p < slot.packets.length; p++) {
                    const pkt = slot.packets[p];
                    pkt.freq = slot.freq;
                    pkt.ch = slot.ch;
                    packets.push(pkt);
                }
                slot.packets = [];
                if (slot.e > 1e-6) {
                    bands.push({
                        ch: slot.ch, freq: slot.freq, e: slot.e, snr: slot.snr,
                        hot: slot.hot, text: slot.text, morse: slot.morse
                    });
                }
            }
            bands.sort(function (a, b) { return b.e - a.e; });
            return { packets: packets, bands: bands.slice(0, 6) };
        }

        return { push: push, poll: poll, forget: forget };
    }

    root.AudioCodec = {
        SR: SR,
        CHARS: CHARS,
        FREQS: FREQS,
        freqForId: freqForId,
        charForFreq: charForFreq,
        poseMessage: poseMessage,
        chatMessage: chatMessage,
        encodeMorse: encodeMorse,
        createListener: createListener,
        cancelOwn: cancelOwn
    };
})(typeof self !== "undefined" ? self : this);
