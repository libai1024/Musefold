import { useState, type FormEvent } from "react";
import { useAccountStore } from "./workbenchCrossFeature";

/**
 * 额度不足的就地恢复：在失败卡上直接兑换，成功后自动重试本张。
 * 规格依据 v0.5 产品文档 §5「就地兑换、原地重试」。
 */
export function InlineQuotaRedeem({
  onRetry,
  disabled,
}: {
  onRetry: () => void;
  disabled?: boolean;
}) {
  const redeem = useAccountStore((s) => s.redeem);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        className="no-drag mt-1 rounded-full border border-danger/35 px-3 py-1 text-[10px] font-medium text-danger transition-colors hover:border-danger"
        onClick={() => setOpen(true)}
        data-testid="result-redeem-open"
      >
        输入兑换码
      </button>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !code.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      await redeem(code.trim());
      setMessage("已到账，正在重试…");
      setOpen(false);
      onRetry();
    } catch (error) {
      const e = error as { message?: string };
      setMessage(e?.message || "兑换失败，请检查兑换码后重试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="mt-1 flex w-full max-w-[190px] flex-col items-stretch gap-1.5"
      onSubmit={submit}
    >
      <input
        value={code}
        onChange={(event) => setCode(event.target.value)}
        placeholder="兑换码"
        autoFocus
        spellCheck={false}
        className="no-drag h-7 rounded-full border border-danger/35 bg-transparent px-3 text-center font-mono text-[10px] text-primary outline-none transition-colors placeholder:text-quaternary focus:border-danger"
        data-testid="result-redeem-code"
      />
      <div className="flex items-center justify-center gap-1.5">
        <button
          type="submit"
          disabled={busy || disabled || !code.trim()}
          className="no-drag rounded-full border border-danger/35 px-3 py-1 text-[10px] font-medium text-danger transition-colors hover:border-danger disabled:opacity-45"
          data-testid="result-redeem-submit"
        >
          {busy ? "兑换中…" : "兑换并重试"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setMessage(null);
          }}
          className="no-drag rounded-full px-2 py-1 text-[10px] text-tertiary transition-colors hover:text-primary"
        >
          取消
        </button>
      </div>
      {message && (
        <span className="text-center text-[9.5px] leading-relaxed">
          {message}
        </span>
      )}
    </form>
  );
}
