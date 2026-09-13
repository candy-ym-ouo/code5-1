import { useEffect } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { SEASON_LABELS, SLOT_LABELS, type WorldSnapshot } from '@shanhai/contracts';
import { useGame } from '../game-context.tsx';

export function GameShell() {
  const { world, notice, error, clearNotice } = useGame();

  useEffect(() => {
    if (!notice && !error) return;
    const timer = window.setTimeout(clearNotice, 5200);
    return () => window.clearTimeout(timer);
  }, [notice, error, clearNotice]);

  return (
    <div className={`app-shell season-${world.season}`}>
      <header className="topbar">
        <NavLink className="brand" to="/play" aria-label="山海植物志首页">
          <span className="brand-mark">山</span>
          <span>
            <strong>山海植物志</strong>
            <small>第 {world.year} 年 · {SEASON_LABELS[world.season]}季</small>
          </span>
        </NavLink>
        <nav className="topnav" aria-label="主要导航">
          <NavLink to="/play">山林</NavLink>
          <NavLink to="/play/journal">笔记</NavLink>
          <NavLink to={`/play/report/${reportYear(world)}`}>年报</NavLink>
          <NavLink to="/settings">设置</NavLink>
        </nav>
        <div className="hud-compact" aria-label="游戏时间">
          <span>{world.day} 日</span>
          <span>{SLOT_LABELS[world.slot - 1] ?? '暮'}</span>
          <strong>{world.actionPoints} AP</strong>
        </div>
      </header>
      {(notice || error) && (
        <button className={`toast ${error ? 'toast-error' : ''}`} onClick={clearNotice} type="button">
          <span>{error ? '操作未完成' : '记录已更新'}</span>
          <strong>{error ?? notice}</strong>
        </button>
      )}
      <main className="page-frame">
        <Outlet context={useGame()} />
      </main>
      <nav className="mobile-nav" aria-label="移动端导航">
        <NavLink to="/play">山林</NavLink>
        <NavLink to="/play/journal">笔记</NavLink>
        <NavLink to={`/play/report/${reportYear(world)}`}>年报</NavLink>
        <NavLink to="/settings">设置</NavLink>
      </nav>
    </div>
  );
}

function reportYear(world: WorldSnapshot): number {
  return world.phase === 'year_review' ? world.year : Math.max(1, world.year - 1);
}
