// Single-tone Morse. Lower id transmits at 2000 Hz, higher id at 3222 Hz.
(function (root) {
    const SR = 44100;
    const FREQ_LOW = 2000;
    const FREQ_HIGH = 3222;
    const UNIT = 0.011;
    const HOP = Math.round(SR * 0.002);
    const WIN = Math.round(SR * 0.006);
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

    function toneFor(myId, otherIds) {
        const ids = [String(myId || "")];
        (otherIds || []).forEach(function (id) { if (id) ids.push(String(id)); });
        const uniq = Array.from(new Set(ids)).sort();
        return uniq[0] === String(myId || "") ? FREQ_LOW : FREQ_HIGH;
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
            return;
        }
        if (slot.hot) {
            slot.spans.push(Math.round(ms));
            if (slot.spans.length > 12) slot.spans.shift();
            if (ms >= unitMs * 0.45 && ms < unitMs * 2) slot.morse += ".";
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

    function createListener() {
        let acc = new Float32Array(0);
        let done = 0;
        const low = makeSlot();
        const high = makeSlot();
        const view = { eLow: 0, eHigh: 0, snrLow: 0, snrHigh: 0 };

        function push(samples) {
            if (!samples || !samples.length) return;
            const next = new Float32Array(acc.length + samples.length);
            next.set(acc);
            next.set(samples, acc.length);
            acc = next;
            const cap = SR * 8;
            if (acc.length > cap) {
                const drop = acc.length - SR * 6;
                acc = new Float32Array(acc.subarray(drop));
                done = Math.max(0, done - drop);
            }
            while (done + WIN <= acc.length) {
                const eL = goertzel(acc, done, FREQ_LOW);
                const eH = goertzel(acc, done, FREQ_HIGH);
                const sL = goertzel(acc, done, FREQ_LOW + 180);
                const sH = goertzel(acc, done, FREQ_HIGH + 180);
                view.eLow = view.eLow * 0.8 + eL * 0.2;
                view.eHigh = view.eHigh * 0.8 + eH * 0.2;
                view.snrLow = eL / (sL + 1e-12);
                view.snrHigh = eH / (sH + 1e-12);
                if (!low.hot && view.snrLow < 2.2) low.floor = low.floor * 0.9 + eL * 0.1;
                if (!high.hot && view.snrHigh < 2.2) high.floor = high.floor * 0.9 + eH * 0.1;
                const hotL = eL > eH * 0.02 && (low.hot ? (eL > low.floor * 3 && view.snrLow > 2) : (eL > low.floor * 8 && view.snrLow > 4));
                const hotH = eH > eL * 0.02 && (high.hot ? (eH > high.floor * 3 && view.snrHigh > 2) : (eH > high.floor * 8 && view.snrHigh > 4));
                hopSlot(low, hotL);
                hopSlot(high, hotH);
                done += HOP;
            }
        }

        function take(slot) {
            const packets = slot.packets.slice();
            slot.packets.length = 0;
            return packets;
        }

        function forget(freq) {
            const slot = freq === FREQ_LOW ? low : high;
            slot.morse = "";
            slot.text = "";
            slot.hot = false;
            slot.run = 0;
            slot.letterDone = false;
            slot.packets = [];
        }

        function poll() {
            return {
                eLow: view.eLow, eHigh: view.eHigh,
                snrLow: view.snrLow, snrHigh: view.snrHigh,
                floorLow: low.floor, floorHigh: high.floor,
                hotLow: low.hot, hotHigh: high.hot,
                spanLow: low.spans.slice(), spanHigh: high.spans.slice(),
                morseLow: low.morse, morseHigh: high.morse,
                textLow: low.text, textHigh: high.text,
                marksLow: low.marks, marksHigh: high.marks,
                packetsLow: take(low), packetsHigh: take(high)
            };
        }

        return { push: push, poll: poll, forget: forget };
    }

    root.AudioCodec = {
        SR: SR,
        FREQ_LOW: FREQ_LOW,
        FREQ_HIGH: FREQ_HIGH,
        toneFor: toneFor,
        poseMessage: poseMessage,
        chatMessage: chatMessage,
        encodeMorse: encodeMorse,
        createListener: createListener
    };
})(typeof self !== "undefined" ? self : this);
