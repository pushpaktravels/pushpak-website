import { ComingSoon } from '../../components/ComingSoon';
export default function UploadPage() {
  return <ComingSoon
    title="Upload & Refresh"
    crumb="Upload & Refresh"
    blurb="Drop a FinBook XLS export here — the system parses it, diffs against the current snapshot, and creates a refresh log entry. The biggest single piece of the build, scheduled for its own dedicated session." />;
}
