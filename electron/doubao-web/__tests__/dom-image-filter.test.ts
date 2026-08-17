import { describe, expect, it } from 'vitest';
import {
  isDoubaoGeneratedCanvasCandidate,
  isDoubaoGeneratedDomImageCandidate,
  isDoubaoUserMessageClassChain,
} from '../dom-image-filter';

describe('Doubao DOM image candidate filtering', () => {
  it('skips SVG placeholders while accepting the paired CDN preview image', () => {
    expect(isDoubaoGeneratedDomImageCandidate({
      src: "data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20width='2048'%20height='2048'/%3e",
      naturalWidth: 2048,
      naturalHeight: 2048,
      displayWidth: 198,
      displayHeight: 198,
    })).toBe(false);

    expect(isDoubaoGeneratedDomImageCandidate({
      src: 'https://p3-flow-imagex-sign.byteimg.com/tos-cn-i-a9rns2rl98/rc_gen_image/example.jpeg~tplv-a9rns2rl98-ds_wm_1_5_dk.png',
      naturalWidth: 384,
      naturalHeight: 384,
      displayWidth: 198,
      displayHeight: 198,
    })).toBe(true);
  });

  it('rejects sidebar thumbnails and small example cards', () => {
    expect(isDoubaoGeneratedDomImageCandidate({
      src: 'https://p3-flow-imagex-sign.byteimg.com/tos-cn-i-a9rns2rl98/thumb.png',
      naturalWidth: 320,
      naturalHeight: 320,
      displayWidth: 20,
      displayHeight: 20,
    })).toBe(false);

    expect(isDoubaoGeneratedDomImageCandidate({
      src: 'https://lf-flow-web-cdn.doubao.com/example.png',
      naturalWidth: 240,
      naturalHeight: 240,
      displayWidth: 70,
      displayHeight: 70,
    })).toBe(false);
  });

  it('distinguishes an uploaded user image from an assistant result by message alignment', () => {
    expect(isDoubaoUserMessageClassChain([
      'container-bl9636 clickable-zXxj6E',
      'flex justify-end',
      'flex-row flex w-full justify-end',
    ])).toBe(true);
    expect(isDoubaoUserMessageClassChain([
      'image-wrapper-YJelRW clickable-axeVcZ',
      'image-box-grid-EYaIcP',
      'flex w-full flex-col space-y-20',
    ])).toBe(false);
  });

  it('accepts the large result canvas used by reference-image generation', () => {
    expect(isDoubaoGeneratedCanvasCandidate({
      width: 1008,
      height: 1344,
      displayWidth: 504,
      displayHeight: 672,
    })).toBe(true);
    expect(isDoubaoGeneratedCanvasCandidate({
      width: 320,
      height: 320,
      displayWidth: 56,
      displayHeight: 56,
    })).toBe(false);
  });
});
