import React from "react";
import ProjectListScreen from "../screens/ProjectListScreen";

// Reuse the video viewer's player, playlist and transition state machine.
// Only the source of scenes and the note-specific presentation differ.
export default function TacticalClipPlayer({ note, noteHeader, onClose, notePlaybackState, onNotePlaybackStateChange, ...props }) {
  return <ProjectListScreen {...props} notePlayback={note}
    notePlaybackState={notePlaybackState} onNotePlaybackStateChange={onNotePlaybackStateChange}
    noteHeader={noteHeader} onCloseNotePlayback={onClose} />;
}
