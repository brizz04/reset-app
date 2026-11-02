"""Genera los sonidos de Reset (public/sfx/*.mp3) con síntesis propia: campanas, pads, barridos de ruido e impactos.

Uso:  python scripts/make-sfx.py        (necesita numpy, scipy y ffmpeg en el PATH)

Todos están en do mayor / la menor para que armonicen entre sí. Son mono, 44,1 kHz, MP3 a 128 kbps.
"""
import os
import subprocess
import tempfile

import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 44100
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'sfx')
RNG = np.random.default_rng(7)
NOTE = {'A2': 110.0, 'C3': 130.81, 'E3': 164.81, 'G3': 196.0, 'A3': 220.0, 'C4': 261.63, 'E4': 329.63, 'G4': 392.0,
        'A4': 440.0, 'C5': 523.25, 'D5': 587.33, 'E5': 659.25, 'G5': 783.99, 'A5': 880.0, 'C6': 1046.5, 'D6': 1174.66,
        'E6': 1318.51, 'G6': 1567.98, 'A6': 1760.0, 'C7': 2093.0}


def tt(d):
    return np.arange(int(d * SR)) / SR


def silence(d):
    return np.zeros(int(d * SR))


def place(buf, x, at=0.0, gain=1.0):
    i = int(at * SR)
    if i >= len(buf):
        return
    n = min(len(x), len(buf) - i)
    buf[i:i + n] += x[:n] * gain


def lowpass(x, fc, order=4):
    return signal.sosfilt(signal.butter(order, fc / (SR / 2), 'low', output='sos'), x)


def highpass(x, fc, order=4):
    return signal.sosfilt(signal.butter(order, fc / (SR / 2), 'high', output='sos'), x)


def bandpass(x, lo, hi, order=2):
    return signal.sosfilt(signal.butter(order, [lo / (SR / 2), hi / (SR / 2)], 'band', output='sos'), x)


def bell(f, d, decay=0.6, bright=1.0):
    """Campana de cristal: parciales inarmónicos con caídas distintas."""
    t = tt(d)
    y = np.zeros_like(t)
    for r, a in zip([1, 2.0, 2.76, 5.4, 8.93], [1, .45, .3, .12, .06 * bright]):
        y += a * np.sin(2 * np.pi * f * r * t) * np.exp(-t / (decay / (1 + 0.45 * (r - 1))))
    return y * (1 - np.exp(-t / 0.002))


def mallet(f, d, decay=0.5):
    t = tt(d)
    y = np.sin(2 * np.pi * f * t) + .35 * np.sin(2 * np.pi * f * 2 * t) * np.exp(-t / .15) + .12 * np.sin(2 * np.pi * f * 3.9 * t) * np.exp(-t / .06)
    return y * np.exp(-t / decay) * (1 - np.exp(-t / 0.003))


def saw_stack(freqs, d, detune=0.004, voices=3):
    t = tt(d)
    y = np.zeros_like(t)
    for f in freqs:
        for k in range(voices):
            fv = f * (1 + detune * (k - (voices - 1) / 2))
            y += signal.sawtooth(2 * np.pi * fv * t + RNG.uniform(0, 6.28))
    return y / (len(freqs) * voices)


def swell(d, a, r, curve=2.0):
    t = tt(d)
    return np.minimum(1, (t / max(a, 1e-3)) ** curve) * np.minimum(1, ((d - t) / max(r, 1e-3)) ** curve)


def sweep_noise(d, f0, f1, width=0.55):
    """Ruido que sigue una banda de frecuencia que sube o baja (whoosh, estática)."""
    n = int(d * SR)
    x = RNG.standard_normal(n)
    f, t, Z = signal.stft(x, SR, nperseg=1024, noverlap=768)
    centers = np.geomspace(f0, f1, len(t))
    mask = np.exp(-0.5 * ((np.log2(f[:, None] + 1e-6) - np.log2(centers[None, :])) / width) ** 2)
    _, y = signal.istft(Z * mask, SR, nperseg=1024, noverlap=768)
    y = y[:n]
    return np.pad(y, (0, n - len(y)))


def sub_boom(f0, f1, d, decay):
    t = tt(d)
    f = f1 + (f0 - f1) * np.exp(-t / (decay * 0.35))
    phase = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(phase) * np.exp(-t / decay) * (1 - np.exp(-t / 0.002))


def sparkles(d, n, lo=2500, hi=9000, decay=0.18, gain=1.0):
    buf = silence(d + 0.6)
    for _ in range(n):
        f = RNG.uniform(lo, hi)
        place(buf, bell(f, 0.5, decay, 1.4), RNG.uniform(0, d), RNG.uniform(.25, 1) * gain)
    return buf[:int(d * SR)]


def reverb(x, rt=1.0, wet=0.3, tail=None, circular=False):
    n = len(x)
    ir_len = int(rt * 1.3 * SR)
    t = np.arange(ir_len) / SR
    ir = RNG.standard_normal(ir_len) * np.exp(-t * 6.9 / rt)
    ir = lowpass(ir, 6500, 2)
    ir[0] = 0
    ir /= np.sqrt(np.sum(ir ** 2)) + 1e-9
    if circular:  # para bucles: la cola se enrolla al principio
        n_fft = n
        irp = np.zeros(n_fft)
        irp[:min(ir_len, n_fft)] = ir[:n_fft]
        y = np.fft.irfft(np.fft.rfft(x) * np.fft.rfft(irp), n_fft)
        return x * (1 - wet) + y * wet * 1.6
    extra = int((tail if tail is not None else rt * 0.6) * SR)
    xp = np.pad(x, (0, extra))
    y = signal.fftconvolve(xp, ir)[:len(xp)]
    return xp * (1 - wet) + y * wet * 1.6


def finish(x, peak=0.7, fade_in=0.002, fade_out=0.04):
    x = x - np.mean(x)
    x = x / (np.max(np.abs(x)) + 1e-9) * peak
    fi, fo = int(fade_in * SR), int(fade_out * SR)
    if fi:
        x[:fi] *= np.linspace(0, 1, fi)
    if fo:
        x[-fo:] *= np.linspace(1, 0, fo) ** 2
    return x


def save(name, x):
    os.makedirs(OUT, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, name + '.wav')
        wavfile.write(wav, SR, (np.clip(x, -1, 1) * 32767).astype(np.int16))
        mp3 = os.path.join(OUT, name + '.mp3')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', wav, '-ac', '1', '-ar', str(SR), '-b:a', '128k', mp3], check=True)
    print(f'{name:18s} {len(x) / SR:5.2f} s  {os.path.getsize(mp3) // 1024:4d} KB')


# ---------------------------------------------------------------- uso diario
def tap():
    t = tt(0.12)
    click = lowpass(RNG.standard_normal(len(t)), 7000, 2) * np.exp(-t / 0.012)
    body = np.sin(2 * np.pi * 540 * t) * np.exp(-t / 0.03)
    return finish(click * .6 + body, .4, 0.0005, 0.02)


def done():
    buf = silence(0.9)
    place(buf, bell(NOTE['C6'], 0.8, .22), 0.0)
    place(buf, bell(NOTE['G6'], 0.8, .3), 0.085, 1.0)
    place(buf, sparkles(0.4, 5, 3500, 8000, .12, .22), 0.12)
    return finish(reverb(buf, .5, .22, .15), .6)


def all_done():
    buf = silence(2.2)
    for i, n in enumerate(['C5', 'E5', 'G5', 'C6']):
        place(buf, bell(NOTE[n], 1.4, .55), i * 0.095)
    for n in ['C6', 'E6', 'G6']:  # acorde final brillante
        place(buf, bell(NOTE[n], 1.2, .8), 0.4, .55)
    pad = saw_stack([NOTE['C3'], NOTE['G3'], NOTE['E4']], 1.6, .003, 2)
    place(buf, lowpass(pad, 1400, 2) * swell(1.6, .15, .9), 0.05, .35)
    place(buf, sparkles(1.2, 12, 3000, 9000, .25, .3), 0.35)
    return finish(reverb(buf, 1.0, .3, .5), .7)


def notification():
    buf = silence(1.6)
    for i, (n, g) in enumerate([('E5', .8), ('A5', .85), ('C6', 1.0)]):
        place(buf, mallet(NOTE[n], 0.9, .45), i * 0.17, g)
        place(buf, bell(NOTE[n] * 2, .6, .25, .5), i * 0.17, .12)
    pad = saw_stack([NOTE['A3'], NOTE['E4']], 1.1, .004, 2)
    place(buf, lowpass(pad, 1100, 2) * swell(1.1, .25, .6), 0.0, .22)
    return finish(reverb(buf, .9, .3, .4), .65)


# ---------------------------------------------------------------- nivel
def level_up():
    buf = silence(3.6)
    place(buf, sweep_noise(.7, 250, 7000), 0.0, .5)
    t = tt(.7)
    f = 140 * (7 ** (t / .7))
    riser = signal.sawtooth(2 * np.pi * np.cumsum(f) / SR)
    place(buf, lowpass(riser, 3500, 2) * (t / .7) ** 2, 0.0, .28)
    place(buf, sub_boom(95, 38, 1.0, .5), 0.7, 1.0)
    place(buf, lowpass(RNG.standard_normal(int(.35 * SR)), 2500, 2) * np.exp(-tt(.35) / .07), 0.7, .55)
    for p, g in zip([310.0, 790.0, 1330.0], [.25, .18, .1]):
        place(buf, np.sin(2 * np.pi * p * tt(1.2)) * np.exp(-tt(1.2) / .45), 0.7, g)
    for i, n in enumerate(['C4', 'E4', 'G4', 'C5']):
        d = 2.4 - i * .18
        note = lowpass(saw_stack([NOTE[n], NOTE[n] * 2], d, .006, 3), 2600, 2) * swell(d, .05, 1.0, 1.4)
        place(buf, note, 0.78 + i * 0.16, .42)
    place(buf, sparkles(2.1, 30, 2500, 10000, .3, .35), 1.0)
    for n in ['C6', 'E6', 'G6', 'C7']:
        place(buf, bell(NOTE[n], 1.6, .9), 1.0 + ['C6', 'E6', 'G6', 'C7'].index(n) * .12, .3)
    return finish(reverb(buf, 1.5, .33, .9), .85, .002, .25)


# ---------------------------------------------------------------- apertura de pack
def pack_charge():
    d = 1.1
    t = tt(d)
    f = 110 * (9 ** (t / d))
    tone = signal.sawtooth(2 * np.pi * np.cumsum(f) / SR) * .5 + np.sin(2 * np.pi * np.cumsum(f * 2.01) / SR) * .3
    am = 0.55 + 0.45 * np.sin(2 * np.pi * np.cumsum(8 + 26 * (t / d) ** 2) / SR)
    tone = lowpass(tone, 4500, 2) * am * (t / d) ** 1.5
    stat = sweep_noise(d, 400, 7500, .6) * (t / d) ** 1.3
    crackle = np.zeros_like(t)
    for _ in range(int(40 + 160 * 1)):
        p = d * RNG.random() ** 0.6
        i = int(p * SR)
        k = int(.003 * SR)
        if i + k < len(t):
            crackle[i:i + k] += RNG.standard_normal(k) * np.hanning(k) * (.25 + .75 * p / d)
    x = tone * .6 + stat * .55 + highpass(crackle, 2500, 2) * .5
    return finish(x, .72, 0.01, 0.004)


def pack_tear():
    d = .55
    t = tt(d)
    rip = highpass(RNG.standard_normal(len(t)), 2500, 2) * np.exp(-t / .12)
    rip *= 0.5 + 0.5 * np.sign(np.sin(2 * np.pi * 70 * t + 2 * np.sin(2 * np.pi * 9 * t)))  # fibras que se rompen
    zap_f = 3200 * np.exp(-t / .06) + 500
    zap = np.sin(2 * np.pi * np.cumsum(zap_f) / SR) * np.exp(-t / .06)
    buf = silence(d)
    place(buf, rip, 0, .7)
    place(buf, zap, 0.01, .4)
    place(buf, sparkles(.4, 8, 4000, 10000, .1, .35), 0.06)
    return finish(reverb(buf, .4, .15, .1), .72, 0.0005, .05)


def pack_slam():
    d = .8
    buf = silence(d)
    place(buf, np.tanh(sub_boom(130, 34, d, .22) * 2.2), 0, 1.0)
    place(buf, lowpass(RNG.standard_normal(int(.18 * SR)), 3000, 2) * np.exp(-tt(.18) / .04), 0, .7)
    for p, g in zip([310.0, 790.0, 1330.0, 2100.0], [.3, .22, .12, .06]):
        place(buf, np.sin(2 * np.pi * p * tt(.6)) * np.exp(-tt(.6) / .12), 0, g)
    return finish(reverb(buf, .6, .18, .15), .82, 0.0005, .08)


# ---------------------------------------------------------------- revelado de cartas
def reveal_common():
    buf = silence(.9)
    place(buf, bell(NOTE['E6'], .8, .28), 0)
    place(buf, sparkles(.3, 3, 5000, 9000, .1, .12), 0.02)
    return finish(reverb(buf, .5, .22, .2), .55)


def reveal_rare():
    buf = silence(1.2)
    place(buf, bell(NOTE['G5'], 1.0, .4), 0)
    place(buf, bell(NOTE['D6'], 1.0, .5), 0.1, .9)
    place(buf, sweep_noise(.45, 1500, 9000, .5), 0.0, .12)
    place(buf, sparkles(.6, 8, 3500, 9000, .16, .22), 0.1)
    return finish(reverb(buf, .7, .26, .3), .65)


def reveal_epic():
    buf = silence(1.8)
    for i, n in enumerate(['A5', 'C6', 'E6', 'A6']):
        place(buf, bell(NOTE[n], 1.3, .7), 0.05 + i * .07, .8)
    place(buf, np.sin(2 * np.pi * NOTE['A2'] * tt(1.5)) * swell(1.5, .12, .9) * .8, 0, .7)
    place(buf, np.sin(2 * np.pi * NOTE['A3'] * tt(1.4)) * swell(1.4, .2, .8) * .35, 0.05)
    place(buf, sweep_noise(.5, 600, 8000, .6), 0, .14)
    place(buf, sparkles(1.2, 22, 3000, 10000, .22, .3), 0.15)
    return finish(reverb(buf, 1.1, .34, .6), .75, 0.002, .12)


def reveal_legendary():
    buf = silence(2.8)
    place(buf, sub_boom(105, 40, 1.0, .35), 0, .9)
    place(buf, sweep_noise(.35, 5000, 400, .6), 0, .35)
    chord = [NOTE['C3'], NOTE['G3'], NOTE['C4'], NOTE['E4'], NOTE['G4']]
    d = 2.2
    t = tt(d)
    voices = saw_stack(chord, d, .005, 3)
    vib = np.sin(2 * np.pi * 5.2 * t) * .004
    voices = voices * (1 + vib)
    choir = sum(bandpass(voices, lo, hi, 2) * g for lo, hi, g in [(650, 950, 1.0), (1000, 1350, .7), (2600, 3200, .35)])
    place(buf, choir * swell(d, .6, 1.0, 1.4), 0.1, 1.2)
    brass = lowpass(saw_stack([NOTE['C5'], NOTE['C5'] * 2], 1.8, .006, 3), 2800, 2) * swell(1.8, .08, .9, 1.4)
    place(buf, brass, 0.25, .45)
    for i, n in enumerate(['C6', 'E6', 'G6', 'C7', 'E6', 'G6']):
        place(buf, bell(NOTE.get(n, 2637.0), 1.8, 1.0), 0.3 + i * .11, .38)
    place(buf, sparkles(2.0, 40, 2500, 11000, .3, .3), 0.35)
    return finish(reverb(buf, 1.6, .36, 1.0), .88, 0.002, .3)


# ---------------------------------------------------------------- ambiente (bucle de 60 s)
def ambient_breathing(d=60.0):
    n = int(d * SR)
    t = np.arange(n) / SR
    snap = lambda f: round(f * d) / d  # frecuencias con ciclos enteros: el bucle empalma sin salto
    x = np.zeros(n)
    for f, g in [(NOTE['A2'], 1.0), (NOTE['E3'], .55), (NOTE['A3'], .45), (NOTE['C4'], .22), (NOTE['E4'], .16)]:
        for det in (-0.35, 0.0, 0.35):
            x += g * np.sin(2 * np.pi * snap(f + det) * t + RNG.uniform(0, 6.28)) / 3
    breath = 0.65 + 0.35 * np.sin(2 * np.pi * (8 / d) * t - 1.2)  # respiración lenta: 8 ciclos en 60 s (7,5 s cada uno)
    x *= breath
    drone = np.sin(2 * np.pi * snap(55.0) * t) * .5 * (0.8 + 0.2 * np.sin(2 * np.pi * (4 / d) * t))
    x += drone
    air = sweep_noise(d, 300, 2500, 1.2) * .035 * (0.6 + 0.4 * np.sin(2 * np.pi * (8 / d) * t - 0.6))
    x += air
    chimes = np.zeros(n)
    for at, f in zip([6, 17, 26, 38, 47, 55], ['E5', 'A5', 'C6', 'E6', 'A5', 'G5']):
        c = bell(NOTE[f], 4.0, 1.6, .6)
        i = int(at * SR)
        idx = (np.arange(len(c)) + i) % n  # la cola da la vuelta al principio
        np.add.at(chimes, idx, c * .12)
    x += chimes
    x = reverb(x, 2.2, .42, circular=True)
    x = x - np.mean(x)
    return x / np.max(np.abs(x)) * 0.5


SOUNDS = {
    'tap': tap, 'done': done, 'all-done': all_done, 'level-up': level_up,
    'pack-charge': pack_charge, 'pack-tear': pack_tear, 'pack-slam': pack_slam,
    'reveal-common': reveal_common, 'reveal-rare': reveal_rare, 'reveal-epic': reveal_epic, 'reveal-legendary': reveal_legendary,
    'notification': notification,
}

if __name__ == '__main__':
    for name, fn in SOUNDS.items():
        save(name, fn())
    save('ambient-breathing', ambient_breathing())
