'use client';

import { useEffect, useState } from 'react';
import { fetchCommentaryProviders } from '@/lib/api';
import type { CommentaryProvider, ProviderInfo } from '@/lib/api';
import { useCommentarySettings } from '@/lib/commentarySettings';

/**
 * Settings panel for LLM commentary. Lives inside the intro overlay.
 * Users toggle it on, pick a provider, optionally override the model,
 * and paste an API key for anthropic/openai providers.
 * Bedrock pulls its key from AWS_BEARER_TOKEN_BEDROCK on the server.
 */
export function CommentarySettings({ busy }: { busy: boolean }) {
  const { settings, update } = useCommentarySettings();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetchCommentaryProviders()
      .then(setProviders)
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  const currentInfo = providers.find((p) => p.id === settings.provider);

  return (
    <div className="border border-[rgba(177,139,74,0.3)] rounded px-4 py-3 mb-5">
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(e) => update({ enabled: e.target.checked })}
          disabled={busy}
          className="accent-[var(--gilt)]"
        />
        <span className="text-[11px] uppercase tracking-[0.25em] opacity-80">
          LLM Commentary
        </span>
        <span className="text-[10px] opacity-55 ml-auto">
          {settings.enabled ? 'on' : 'off'}
        </span>
      </label>

      {settings.enabled && (
        <div className="mt-3 space-y-3">
          {/* Provider */}
          <div>
            <div className="text-[10px] uppercase tracking-[0.25em] opacity-60 mb-1">
              Provider
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {(['bedrock', 'anthropic', 'openai'] as CommentaryProvider[]).map((p) => {
                const info = providers.find((x) => x.id === p);
                return (
                  <button
                    key={p}
                    className="gilt-btn text-[11px] py-1.5"
                    onClick={() => update({ provider: p, model: '' })}
                    style={{
                      opacity: settings.provider === p ? 1 : 0.5,
                      borderColor:
                        settings.provider === p
                          ? 'var(--gilt)'
                          : 'rgba(177, 139, 74, 0.35)',
                    }}
                    disabled={busy}
                    title={info?.auth}
                  >
                    {info?.label ?? p}
                  </button>
                );
              })}
            </div>
            {currentInfo && (
              <div className="text-[10px] opacity-50 mt-1.5">
                Auth: {currentInfo.auth}
                {settings.provider === 'bedrock' && (
                  <>
                    {' · '}
                    <span
                      className={
                        currentInfo.server_configured
                          ? 'text-[var(--gilt)]'
                          : 'text-oxblood'
                      }
                    >
                      {currentInfo.server_configured
                        ? 'server token present'
                        : 'server token missing'}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Model override */}
          <div>
            <div className="text-[10px] uppercase tracking-[0.25em] opacity-60 mb-1">
              Model{' '}
              <span className="opacity-55 normal-case tracking-normal">
                (leave blank for default: {currentInfo?.default_model ?? '…'})
              </span>
            </div>
            <input
              type="text"
              value={settings.model}
              onChange={(e) => update({ model: e.target.value })}
              placeholder={currentInfo?.default_model ?? ''}
              className="w-full"
              disabled={busy}
            />
          </div>

          {/* API key (for anthropic / openai only) */}
          {settings.provider === 'anthropic' && (
            <div>
              <div className="text-[10px] uppercase tracking-[0.25em] opacity-60 mb-1">
                Anthropic API Key
              </div>
              <input
                type="password"
                value={settings.anthropicKey}
                onChange={(e) => update({ anthropicKey: e.target.value })}
                placeholder="sk-ant-…"
                className="w-full"
                disabled={busy}
              />
              <div className="text-[10px] opacity-45 mt-1">
                Stored in your browser's localStorage only.
              </div>
            </div>
          )}
          {settings.provider === 'openai' && (
            <div>
              <div className="text-[10px] uppercase tracking-[0.25em] opacity-60 mb-1">
                OpenAI API Key
              </div>
              <input
                type="password"
                value={settings.openaiKey}
                onChange={(e) => update({ openaiKey: e.target.value })}
                placeholder="sk-…"
                className="w-full"
                disabled={busy}
              />
              <div className="text-[10px] opacity-45 mt-1">
                Stored in your browser's localStorage only.
              </div>
            </div>
          )}

          {/* Language */}
          <div>
            <div className="text-[10px] uppercase tracking-[0.25em] opacity-60 mb-1">
              Language
            </div>
            <div className="flex gap-1.5">
              {[
                { id: 'ko', label: '한국어' },
                { id: 'en', label: 'English' },
                { id: 'ja', label: '日本語' },
              ].map((lang) => (
                <button
                  key={lang.id}
                  className="gilt-btn text-[11px] py-1"
                  onClick={() => update({ language: lang.id })}
                  style={{
                    opacity: settings.language === lang.id ? 1 : 0.5,
                    borderColor:
                      settings.language === lang.id
                        ? 'var(--gilt)'
                        : 'rgba(177, 139, 74, 0.35)',
                  }}
                  disabled={busy}
                >
                  {lang.label}
                </button>
              ))}
            </div>
          </div>

          {loadError && (
            <div className="text-[10px] text-oxblood">
              Provider list error: {loadError}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
