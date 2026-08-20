// src/pet/PetApp.tsx
// 桌宠本体。职责只有三件：播主进程指定的动画、把交互报回去、拖着走。
// 播哪个动画完全由主进程的状态机决定，这里不做任何状态推断。
//
// 状态可以是单个动画资源（例如 APNG），也可以是多张关键帧序列。
// 关键帧序列会全部解码完成后再开始轮播，避免未加载帧短暂露出透明桌面。

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PetFrame } from '@shared/types/pet';

export function PetApp(): JSX.Element | null {
  const [frame, setFrame] = useState<PetFrame | null>(null);
  /**
   * 已经加载完、正在显示的那一帧指令。
   *
   * sprite 有几百 KB，直接换 <img src> 会先空一帧再出图。新状态的首帧
   * 在离屏加载完成后才顶替显示，切换就不会露白。
   */
  const [shown, setShown] = useState<PetFrame | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const frameDirection = useRef<1 | -1>(1);
  const decodedImages = useRef(new Map<string, HTMLImageElement>());
  const [dragging, setDragging] = useState(false);
  const lastScreen = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let alive = true;
    void window.api.pet.getFrame().then((initial) => {
      if (alive && initial) setFrame(initial);
    });
    const off = window.api.pet.onFrame(setFrame);
    return () => {
      alive = false;
      off();
    };
  }, []);

  useEffect(() => {
    if (!frame) return;
    // 同一状态重复推送时不重走加载，否则轮播会被打断重头播。
    // 反应状态可能复用同一条 APNG，但 state 变化仍要让 CSS/状态机语义更新。
    if (
      shown?.state === frame.state
      && shown.srcs.length === frame.srcs.length
      && shown.srcs.every((src, index) => src === frame.srcs[index])
    ) return;
    let alive = true;
    const commit = (): void => {
      if (!alive) return;
      setShown(frame);
      setFrameIndex(0);
      frameDirection.current = 1;
    };

    // 等待整组资源可解码后再提交。旧实现只等待首帧，其余帧异步预热；
    // 轮播速度快于磁盘解码时会显示一帧透明窗口，在浅色桌面上看起来就是闪白。
    const pending = frame.srcs.map(async (src) => {
      const cached = decodedImages.current.get(src);
      if (cached?.complete) return;
      const image = new Image();
      image.src = src;
      decodedImages.current.set(src, image);
      try {
        await image.decode();
      } catch {
        // 保持原有容错：坏资源交给最终 <img> 呈现，不让状态永远卡在旧画面。
      }
    });
    void Promise.all(pending).then(commit);

    return () => {
      alive = false;
    };
  }, [frame, shown?.srcs]);

  // 主进程会保持透明窗口隐藏，直到角色首帧真正提交到 DOM。
  useEffect(() => {
    if (!shown) return;
    const id = requestAnimationFrame(() => window.api.pet.ready());
    return () => cancelAnimationFrame(id);
  }, [shown]);

  // 兼容仍由多张图片组成的主题；APNG 等单文件动画由浏览器自行播放。
  useEffect(() => {
    if (!shown || shown.srcs.length <= 1) return;
    const timer = setInterval(
      () => {
        setFrameIndex((index) => {
          const last = shown.srcs.length - 1;
          if (shown.loop === 'once-freeze') return Math.min(last, index + 1);
          if (shown.loop !== 'pingpong') return (index + 1) % shown.srcs.length;

          const next = index + frameDirection.current;
          if (next >= last) {
            frameDirection.current = -1;
            return last;
          }
          if (next <= 0) {
            frameDirection.current = 1;
            return 0;
          }
          return next;
        });
      },
      Math.max(80, shown.frameMs),
    );
    return () => clearInterval(timer);
  }, [shown]);

  /** 按下后累计移动超过这个距离才算拖拽，单纯点击不触发 react-drag，免得连点时表情抖动 */
  const DRAG_THRESHOLD_PX = 4;
  const dragActive = useRef(false);
  const pressTravel = useRef(0);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    window.api.pet.interact('pointer-down');
    lastScreen.current = { x: e.screenX, y: e.screenY };
    pressTravel.current = 0;
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const last = lastScreen.current;
    if (!last) return;
    const dx = e.screenX - last.x;
    const dy = e.screenY - last.y;
    if (dx === 0 && dy === 0) return;
    lastScreen.current = { x: e.screenX, y: e.screenY };

    if (!dragActive.current) {
      pressTravel.current += Math.abs(dx) + Math.abs(dy);
      if (pressTravel.current < DRAG_THRESHOLD_PX) return;
      dragActive.current = true;
      setDragging(true);
      window.api.pet.interact('drag-start');
    }
    // 位移由主进程直接读取系统鼠标坐标，避免透明窗口移动造成事件掉帧。
  }, []);

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!lastScreen.current) return;
    lastScreen.current = null;
    if (dragActive.current) {
      dragActive.current = false;
      setDragging(false);
      window.api.pet.interact('drag-end');
    }
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  if (!shown) return null;

  return (
    <div className="pet-stage">
      {shown.message ? <div className="pet-bubble">{shown.message}</div> : null}
      {/* motion 容器承载按状态映射的微动画（呼吸、点头、漂浮），拖拽缩放在
          内层帧容器上 —— 两层 transform 各自独立，否则动画会覆盖拖拽反馈 */}
      <div className="pet-motion" data-state={shown.state}>
        <div
          className={`pet-frames${dragging ? ' is-dragging' : ''}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={() => window.api.pet.interact('open-main')}
          onMouseEnter={() => window.api.pet.interact('wake')}
          onContextMenu={(e) => {
            e.preventDefault();
            window.api.pet.openMenu();
          }}
        >
          <img
            className="pet-sprite"
            src={shown.srcs[Math.min(frameIndex, shown.srcs.length - 1)]}
            alt=""
            draggable={false}
          />
        </div>
      </div>
    </div>
  );
}
