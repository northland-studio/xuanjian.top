import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 自写语音播放框（QQ 风格语音条）
 *
 * 为什么不用原生 <audio controls>：
 *  - 原生控件在浅色/深色气泡里都是浏览器默认皮肤，和站点风格完全不搭，移动端还被系统播放器接管
 *  - 原生控件宽度固定，不能按语音时长变化，也没有「未播放红点 / 播放中波形 / 倍速」这些聊天软件的基本手感
 *
 * 交互（对齐 QQ）：
 *  - 整条气泡可点：播放 / 暂停；波形条在播放时跳动
 *  - 宽度随时长增长（1 秒最窄，60 秒最宽），右侧显示秒数
 *  - 自己发的气泡左右镜像（秒数在左、波形在右）
 *  - 未播放的语音左侧有一个红点，播放过就不再出现（记录在 localStorage）
 *  - 同一时刻只允许一条语音在响，点第二条会自动停掉第一条
 *  - 播放中右下角出现倍速按钮，点一下在 1x → 1.5x → 2x 之间循环
 *
 * 外观完全继承气泡的 currentColor：气泡文字是白色（自己的蓝色气泡）就是白色，
 * 是深灰（对方气泡）就是深灰，不需要为每种气泡单独配色。
 */

const SPEEDS = [1, 1.5, 2];
const PLAYED_KEY = 'xj_voice_played_v1';
const PLAYED_MAX = 400;

/** 同时只允许一条语音播放：模块级记录「上一条的暂停函数」 */
let stopCurrent = null;

function readPlayed() {
  try {
    const arr = JSON.parse(localStorage.getItem(PLAYED_KEY) || '[]');
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function markPlayed(url) {
  if (!url) return;
  try {
    const s = readPlayed();
    s.add(url);
    const arr = [...s].slice(-PLAYED_MAX);
    localStorage.setItem(PLAYED_KEY, JSON.stringify(arr));
  } catch {
    // 隐私模式等场景写不了 localStorage，忽略即可
  }
}

function fmtSecs(n) {
  const s = Math.max(1, Math.round(n || 0));
  return s + '″';
}

export default function VoiceBubble({ url, duration = 0, mine = false, className = '' }) {
  const audioRef = useRef(null);
  const rafRef = useRef(0);
  const mountedRef = useRef(true);

  const [playing, setPlaying] = useState(false);
  const [secs, setSecs] = useState(duration > 0 ? duration : 0);
  const [progress, setProgress] = useState(0);
  const [speedIdx, setSpeedIdx] = useState(0);
  const [failed, setFailed] = useState(false);
  const [played, setPlayed] = useState(() => (url ? readPlayed().has(url) : false));

  /** 音频对象懒创建：列表里几十条语音也不会一起发请求 */
  const getAudio = useCallback(() => {
    if (audioRef.current) return audioRef.current;
    const a = new Audio();
    a.preload = 'none';
    a.src = url;
    a.addEventListener('loadedmetadata', () => {
      if (!mountedRef.current) return;
      if ((!duration || duration <= 0) && isFinite(a.duration)) setSecs(a.duration);
    });
    a.addEventListener('ended', () => {
      if (!mountedRef.current) return;
      cancelAnimationFrame(rafRef.current);
      setPlaying(false);
      setProgress(1);
    });
    a.addEventListener('error', () => {
      if (!mountedRef.current) return;
      cancelAnimationFrame(rafRef.current);
      setPlaying(false);
      setFailed(true);
    });
    audioRef.current = a;
    return a;
  }, [url, duration]);

  const pause = useCallback(() => {
    const a = audioRef.current;
    if (a) a.pause();
    cancelAnimationFrame(rafRef.current);
    setPlaying(false);
    if (stopCurrent === pause) stopCurrent = null;
  }, []);

  const tick = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    const total = a.duration;
    if (isFinite(total) && total > 0) setProgress(Math.min(1, a.currentTime / total));
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const play = useCallback(async () => {
    const a = getAudio();
    a.playbackRate = SPEEDS[speedIdx];
    // 播完再点：从头再来
    if (a.ended) {
      a.currentTime = 0;
      setProgress(0);
    }
    try {
      await a.play();
      if (!mountedRef.current) return;
      if (stopCurrent && stopCurrent !== pause) stopCurrent();
      stopCurrent = pause;
      setFailed(false);
      setPlaying(true);
      markPlayed(url);
      setPlayed(true);
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      setFailed(true);
      setPlaying(false);
    }
  }, [getAudio, pause, speedIdx, tick, url]);

  const toggle = useCallback(() => {
    if (playing) pause();
    else play();
  }, [playing, pause, play]);

  useEffect(() => () => {
    mountedRef.current = false;
    cancelAnimationFrame(rafRef.current);
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.src = '';
    }
    if (stopCurrent === pause) stopCurrent = null;
  }, [pause]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = SPEEDS[speedIdx];
  }, [speedIdx]);

  if (!url) return null;

  // 宽度随时长增长：一秒最窄，越长越宽（上限 60 秒），QQ 的同款观感
  const shown = secs > 0 ? secs : 3;
  const width = Math.round(104 + Math.min(Math.min(shown, 60), 60) * 2.4);
  const pct = Math.round(progress * 100);

  return (
    <span
      className={`vb${mine ? ' vb--mine' : ''}${playing ? ' is-playing' : ''}${failed ? ' is-failed' : ''}${className ? ' ' + className : ''}`}
      style={{ width }}
      role="button"
      tabIndex={0}
      aria-label={failed ? '语音加载失败' : `${playing ? '暂停' : '播放'}语音，${fmtSecs(shown)}`}
      title={failed ? '语音加载失败，点击重试' : `${playing ? '点击暂停' : '点击播放'} · ${fmtSecs(shown)}`}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      }}
    >
      {!mine && !played && !playing && <span className="vb-dot" aria-hidden="true" />}

      <span className="vb-waves" aria-hidden="true">
        <i className="vb-bar" />
        <i className="vb-bar" />
        <i className="vb-bar" />
        <i className="vb-bar" />
      </span>

      <span className="vb-secs">{failed ? '重试' : fmtSecs(shown)}</span>

      {playing && (
        <span
          className="vb-speed"
          title="切换播放速度"
          onClick={(e) => {
            e.stopPropagation();
            setSpeedIdx((i) => (i + 1) % SPEEDS.length);
          }}
        >
          {SPEEDS[speedIdx]}x
        </span>
      )}

      <span className="vb-track" aria-hidden="true">
        <span className="vb-fill" style={{ width: pct + '%' }} />
      </span>
    </span>
  );
}
