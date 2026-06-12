"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

// The id of the day-board stop the user has currently selected, shared between
// the day board (which sets it on click) and the map (which flies to that
// stop's location when it changes). Lives in React state on the client only —
// it's transient view state, not part of the durable LiveObjects trip state, so
// it deliberately isn't synced to other viewers.
interface SelectedStopValue {
  selectedStopId: string | null;
  // A monotonically increasing tick bumped on every select, even a re-select of
  // the already-selected stop, so the map can re-fly when a user clicks the
  // same row twice.
  selectNonce: number;
  selectStop: (stopId: string) => void;
}

const SelectedStopContext = createContext<SelectedStopValue>({
  selectedStopId: null,
  selectNonce: 0,
  selectStop: () => {},
});

export function SelectedStopProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const [selectNonce, setSelectNonce] = useState(0);

  const selectStop = useCallback((stopId: string) => {
    setSelectedStopId(stopId);
    setSelectNonce((n) => n + 1);
  }, []);

  const value = useMemo(
    () => ({ selectedStopId, selectNonce, selectStop }),
    [selectedStopId, selectNonce, selectStop],
  );

  return (
    <SelectedStopContext.Provider value={value}>
      {children}
    </SelectedStopContext.Provider>
  );
}

export function useSelectedStop(): SelectedStopValue {
  return useContext(SelectedStopContext);
}
