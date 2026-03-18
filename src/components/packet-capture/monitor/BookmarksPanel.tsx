import { useState, useEffect } from "react";
import { invokeTauri } from "@/api/invoke";
import { deletePacketBookmark } from "@/api/packetCapture";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Bookmark, Trash2, Loader2, Tag } from "@/lib/icons";
import { TooltipWrapper } from "@/components/ui/tooltip-wrapper";
import { tooltips } from "@/lib/tooltips";
import { useNotifications } from "@/hooks/useNotifications";
import { formatTime } from "@/lib/dateTime";

interface PacketBookmark {
  id: string;
  sessionId: string;
  packetIndex: number;
  timestamp: string;
  note?: string;
  tags: string[];
  createdAt: string;
}

interface BookmarksPanelProps {
  sessionId: string | null;
  onJumpToPacket: (index: number) => void;
}

export function BookmarksPanel({ sessionId, onJumpToPacket }: BookmarksPanelProps) {
  const [bookmarks, setBookmarks] = useState<PacketBookmark[]>([]);
  const [loading, setLoading] = useState(false);
  const { notify } = useNotifications();

  useEffect(() => {
    if (sessionId) {
      fetchBookmarks();
    } else {
      setBookmarks([]);
    }
  }, [sessionId]);

  const fetchBookmarks = async () => {
    if (!sessionId) return;

    try {
      setLoading(true);
      const savedBookmarks = await invokeTauri<PacketBookmark[]>("list_packet_bookmarks", {
        sessionId,
      });
      setBookmarks(savedBookmarks);
    } catch (error: any) {
      notify({
        type: "error",
        title: "Failed to Load Bookmarks",
        description: error.message || "Unknown error",
        source: "packet-capture",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deletePacketBookmark(id);
      await fetchBookmarks();
      notify({
        type: "success",
        title: "Bookmark Deleted",
        description: "Bookmark has been deleted",
        source: "packet-capture",
      });
    } catch (error: any) {
      notify({
        type: "error",
        title: "Failed to Delete Bookmark",
        description: error.message || "Unknown error",
        source: "packet-capture",
      });
    }
  };

  const formatTimestamp = (timestamp: string) => formatTime(timestamp);

  if (!sessionId) {
    return (
      <Card className="ui-surface-card">
        <CardContent className="p-4">
          <EmptyState compact variant="inline" title="Start a capture to create bookmarks" />
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card className="ui-surface-card">
        <CardContent className="p-4">
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="ui-surface-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Bookmark className="h-4 w-4" />
          Bookmarks ({bookmarks.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {bookmarks.length === 0 ? (
          <EmptyState compact variant="inline" title="No bookmarks" description="Right-click a packet to bookmark it." />
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {bookmarks.map((bookmark) => (
              <div
                key={bookmark.id}
                className="ui-surface-card p-2 hover:bg-muted/30"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <TooltipWrapper entry={tooltips.captureBookmarkJump}>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onJumpToPacket(bookmark.packetIndex)}
                          className="h-6 px-2 text-xs"
                        >
                          Packet #{bookmark.packetIndex}
                        </Button>
                      </TooltipWrapper>
                      <span className="text-xs text-muted-foreground">
                        {formatTimestamp(bookmark.timestamp)}
                      </span>
                    </div>
                    {bookmark.note && (
                      <p className="text-xs text-muted-foreground mb-1">{bookmark.note}</p>
                    )}
                    {bookmark.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {bookmark.tags.map((tag, idx) => (
                          <Badge key={idx} variant="secondary" className="text-2xs h-4 px-1">
                            <Tag className="h-2.5 w-2.5 mr-0.5" />
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <TooltipWrapper entry={tooltips.captureBookmarkDelete}>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleDelete(bookmark.id)}
                      className="h-6 px-2"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </TooltipWrapper>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
