export default function RunStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    COMPLETED: 'bg-green-800 text-green-200',
    RUNNING:   'bg-yellow-800 text-yellow-200',
    QUEUED:    'bg-gray-700 text-gray-300',
    FAILED:    'bg-red-800 text-red-200',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[status] ?? 'bg-gray-700 text-gray-300'}`}>
      {status}
    </span>
  );
}
