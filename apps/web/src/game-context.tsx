import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import type { GameCommand, WorldSnapshot } from '@shanhai/contracts';
import { ApiError, api, commandRequest } from './api.ts';

interface GameContextValue {
  world: WorldSnapshot;
  execute: (command: GameCommand) => Promise<MutationSuccess>;
  pending: boolean;
  notice: string;
  error: string | null;
  clearNotice: () => void;
}

interface MutationSuccess {
  world: WorldSnapshot;
  event: WorldSnapshot['recentEvents'][number];
  evaluation: unknown;
}

const GameContext = createContext<GameContextValue | null>(null);


export function GameProvider() {
  const location = useLocation();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const clearNotice = useCallback(() => {
    setNotice('');
    setError(null);
  }, []);

  const query = useQuery({
    queryKey: ['world'],
    queryFn: async () => {
      const current = await api.getCurrent();
      if (!current.world) {
        throw new ApiError(401, {
          code: 'UNAUTHENTICATED',
          message: '当前没有可继续的观察档案',
          traceId: 'client',
          retryable: false
        });
      }
      return current.world;
    }
  });

  const mutation = useMutation({
    mutationFn: (command: GameCommand) => {
      if (!query.data) {
        throw new Error('世界状态尚未加载');
      }
      return api.sendCommand(query.data.saveId, commandRequest(command, query.data.revision));
    },
    onSuccess: (result) => {
      queryClient.setQueryData(['world'], result.world);
      queryClient.setQueryData(['current'], {
        save: {
          id: result.world.saveId,
          year: result.world.year,
          season: result.world.season,
          revision: result.world.revision
        },
        world: result.world
      });
      void queryClient.invalidateQueries({ queryKey: ['journal'] });
      void queryClient.invalidateQueries({ queryKey: ['species'] });
      void queryClient.invalidateQueries({ queryKey: ['report'] });
      setNotice(result.event.message);
      setError(null);
    },
    onError: (caught) => {
      const apiError = caught as ApiError;
      setError(apiError.payload?.message ?? '操作失败，请重试');
      if (apiError.status === 401 || apiError.status === 404 || apiError.status === 409) {
        void queryClient.invalidateQueries({ queryKey: ['world'] });
        void queryClient.invalidateQueries({ queryKey: ['current'] });
      }
    }
  });

  const value = useMemo<GameContextValue | null>(() => {
    if (!query.data) return null;
    return {
      world: query.data,
      execute: (command) => mutation.mutateAsync(command),
      pending: mutation.isPending,
      notice,
      error,
      clearNotice
    };
  }, [query.data, mutation.mutateAsync, mutation.isPending, notice, error, clearNotice]);

  if (query.isLoading) {
    return (
      <div className="app-loading">
        <div className="loading-mark">山</div>
        <p>正在读取山林档案…</p>
      </div>
    );
  }

  if (query.isError || !value) {
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }

  return (
    <GameContext.Provider value={value}>
      <Outlet context={value} />
    </GameContext.Provider>
  );
}

export function useGame(): GameContextValue {
  const context = useContext(GameContext);
  if (!context) {
    throw new Error('useGame must be used inside GameProvider');
  }
  return context;
}

