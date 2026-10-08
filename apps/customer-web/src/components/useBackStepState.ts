import { useCallback, type SetStateAction } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/** UI steps share the router's history so native Back and Forward stay in sync. */
export function useBackStepState<T>(name: string, initial: T) {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state ?? {};
  const steps = state.flyseriUi ?? {};
  const value: T = Object.prototype.hasOwnProperty.call(steps, name) ? steps[name] : initial;
  const setValue = useCallback((action: SetStateAction<T>) => {
    const next = typeof action === 'function' ? (action as (previous: T) => T)(value) : action;
    if (Object.is(next, value)) return;
    // Closing the topmost panel consumes its opening step instead of adding an empty step.
    if (state.flyseriUiStep?.name === name && Object.is(next, state.flyseriUiStep.previous)) {
      navigate(-1);
      return;
    }
    navigate({ pathname: location.pathname, search: location.search, hash: location.hash }, {
      state: { ...state, flyseriUi: { ...steps, [name]: next }, flyseriUiStep: { name, previous: value } },
      preventScrollReset: true,
    });
  }, [location, name, navigate, value]);
  return [value, setValue] as const;
}
