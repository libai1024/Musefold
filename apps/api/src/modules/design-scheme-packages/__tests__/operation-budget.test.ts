import { expect, it } from 'vitest';
import { PackageOperationBudget } from '../operation-budget.js';

it('shares two slots across operation types and releases each lease once', () => {
  const budget = new PackageOperationBudget();
  const upload = budget.acquire('upload');
  const download = budget.acquire('download');
  expect(() => budget.acquire('import')).toThrow('import');
  upload();
  const importing = budget.acquire('import');
  upload();
  expect(() => budget.acquire('export')).toThrow('export');
  download();
  const exporting = budget.acquire('export');
  importing();
  exporting();
  const first = budget.acquire('again');
  const second = budget.acquire('again');
  expect(() => budget.acquire('overflow')).toThrow('overflow');
  first();
  second();
});

it('does not carry occupancy between separate API application budgets', () => {
  const first = new PackageOperationBudget();
  const second = new PackageOperationBudget();
  const releases = [
    first.acquire('a'),
    first.acquire('a'),
    second.acquire('b'),
    second.acquire('b'),
  ];
  expect(() => first.acquire('busy')).toThrow('busy');
  expect(() => second.acquire('busy')).toThrow('busy');
  for (const release of releases) release();
});
