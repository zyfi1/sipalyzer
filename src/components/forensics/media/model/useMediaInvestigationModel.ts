import { useMemo } from "react";
import {
  buildConsolidatedStreams,
  buildFindingsByStream,
  buildMediaHealth,
  buildMediaSummary,
  buildPrioritizedStreams,
  filterStreamsForDialogContext,
  getDialogEndpointIps,
  getDialogWindowStreams,
  isVoipCallDialog,
} from "./mediaSelectors";
import type { MediaInvestigationModel, UseMediaInvestigationModelInput } from "./types";

export function useMediaInvestigationModel({
  selectedDialog,
  rtpStreams,
  expertFindings,
}: UseMediaInvestigationModelInput): MediaInvestigationModel {
  const selectedDialogSupportsMedia = useMemo(
    () => (selectedDialog ? isVoipCallDialog(selectedDialog) : false),
    [selectedDialog],
  );
  const endpointIps = useMemo(() => getDialogEndpointIps(selectedDialog), [selectedDialog]);
  const rtpInRange = useMemo(
    () => getDialogWindowStreams(selectedDialog, rtpStreams),
    [selectedDialog, rtpStreams],
  );
  const streamsForTable = useMemo(
    () => filterStreamsForDialogContext(rtpInRange, endpointIps),
    [endpointIps, rtpInRange],
  );
  const mediaSummary = useMemo(() => buildMediaSummary(streamsForTable), [streamsForTable]);
  const prioritizedStreams = useMemo(() => buildPrioritizedStreams(streamsForTable), [streamsForTable]);
  const consolidatedStreams = useMemo(() => buildConsolidatedStreams(streamsForTable), [streamsForTable]);
  const mediaHealth = useMemo(() => buildMediaHealth(prioritizedStreams), [prioritizedStreams]);
  const findingsByStream = useMemo(
    () => buildFindingsByStream(streamsForTable, expertFindings),
    [expertFindings, streamsForTable],
  );
  const hasMediaForSelectedCall = selectedDialogSupportsMedia && streamsForTable.length > 0;

  return {
    streamsForTable,
    prioritizedStreams,
    consolidatedStreams,
    findingsByStream,
    mediaSummary,
    mediaHealth,
    selectedDialogSupportsMedia,
    hasMediaForSelectedCall,
  };
}
