import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ApiError, api } from '../api.ts';

export function HomePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [importToken, setImportToken] = useState('');
  const [message, setMessage] = useState('');
  const current = useQuery({
    queryKey: ['current'],
    queryFn: api.getCurrent
  });

  const finish = (world: Awaited<ReturnType<typeof api.createSave>>) => {
    queryClient.setQueryData(['world'], world);
    queryClient.setQueryData(['current'], {
      save: { id: world.saveId, year: world.year, season: world.season, revision: world.revision },
      world
    });
    navigate('/play');
  };

  const createMutation = useMutation({
    mutationFn: api.createSave,
    onSuccess: finish,
    onError: (error) => setMessage((error as ApiError).payload?.message ?? '创建档案失败')
  });

  const importMutation = useMutation({
    mutationFn: () => api.importSave(importToken.trim()),
    onSuccess: finish,
    onError: (error) => setMessage((error as ApiError).payload?.message ?? '恢复档案失败')
  });

  if (current.isLoading) {
    return <div className="home-loading">正在检查本地观察档案…</div>;
  }

  if (current.isError) {
    return (
      <div className="home-loading">
        <p>无法连接到观察服务。</p>
        <button className="button button-secondary" type="button" onClick={() => void current.refetch()}>
          重新连接
        </button>
      </div>
    );
  }

  if (current.data?.save && current.data.world) {
    return (
      <main className="home-screen resume-screen">
        <section className="home-hero compact-hero">
          <p className="eyebrow">FIELD JOURNAL · RESUME</p>
          <h1>山林还在等你记录</h1>
          <p>
            你的档案已经来到第 {current.data.world.year} 年 · {seasonLabel(current.data.world.season)}季
            第 {current.data.world.day} 日。继续观察，或从设置中导出恢复码。
          </p>
          <div className="hero-actions">
            <button
              className="button button-primary"
              type="button"
              onClick={() => {
                queryClient.setQueryData(['world'], current.data.world);
                navigate('/play');
              }}
            >
              继续观察
            </button>
            <button className="button button-quiet" type="button" onClick={() => navigate('/settings')}>
              档案设置
            </button>
          </div>
        </section>
        <div className="season-orbit" aria-hidden="true">
          <span className="orbit spring">春</span>
          <span className="orbit summer">夏</span>
          <span className="orbit autumn">秋</span>
          <span className="orbit winter">冬</span>
        </div>
      </main>
    );
  }

  return (
    <main className="home-screen">
      <section className="home-hero">
        <p className="eyebrow">SHANHAI FIELD JOURNAL</p>
        <h1>山海植物志</h1>
        <h2>让每一次观察，进入下一年度的山林。</h2>
        <p className="hero-copy">
          在不同季节进入山麓、混交林、溪谷与山脊，记录花期、叶片纹理和环境变化。
          你的采集方式会改变植物健康、种子库和下一年度的生态分布。
        </p>
        <div className="hero-actions">
          <button
            className="button button-primary"
            type="button"
            disabled={createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? '正在开辟样线…' : '开始第一年观察'}
          </button>
        </div>
      </section>

      <section className="home-features" aria-label="游戏核心">
        <article>
          <span>01</span>
          <h3>四季进入山林</h3>
          <p>每个季节拥有独立环境、天气与物候窗口，时间推进不可逆。</p>
        </article>
        <article>
          <span>02</span>
          <h3>真实记录笔记</h3>
          <p>判断花期阶段、叶片纹理并测量环境，结果由服务端权威评分。</p>
        </article>
        <article>
          <span>03</span>
          <h3>承担长期后果</h3>
          <p>错误采集会降低健康与种子库，并在年度报告和分布变化中留下记录。</p>
        </article>
      </section>

      <section className="import-panel">
        <div>
          <p className="eyebrow">RESTORE SAVE</p>
          <h3>已有恢复码？</h3>
          <p>恢复码只能使用一次，成功后会接管对应浏览器档案。</p>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            importMutation.mutate();
          }}
        >
          <input
            aria-label="存档恢复码"
            value={importToken}
            onChange={(event) => setImportToken(event.target.value)}
            placeholder="粘贴存档恢复码"
          />
          <button className="button button-secondary" type="submit" disabled={importToken.trim().length < 20 || importMutation.isPending}>
            恢复档案
          </button>
        </form>
        {message && <p className="form-error">{message}</p>}
      </section>
    </main>
  );
}

function seasonLabel(season: string) {
  return ({ spring: '春', summer: '夏', autumn: '秋', winter: '冬' } as Record<string, string>)[season] ?? season;
}
