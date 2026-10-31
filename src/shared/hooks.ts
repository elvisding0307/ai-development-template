import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from './api';
export function useQuery<T>(load: () => Promise<T>, dependencies: readonly unknown[]) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const request = useRef(0);
  // Callers explicitly list the values used by their query.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reload = useCallback(async () => {
    const id = ++request.current;
    setLoading(true); setError('');
    try { const result = await load(); if (id === request.current) setData(result); }
    catch (e) { if (id === request.current) setError(errorMessage(e)); }
    finally { if (id === request.current) setLoading(false); }
  }, dependencies);
  useEffect(() => { void reload(); return () => { request.current++; }; }, [reload]);
  useEffect(() => {
    const refresh = () => { void reload(); };
    window.addEventListener('library:changed', refresh);
    window.addEventListener('focus', refresh);
    return () => { window.removeEventListener('library:changed', refresh); window.removeEventListener('focus', refresh); };
  }, [reload]);
  return { data, error, loading, reload };
}
