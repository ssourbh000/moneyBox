type BadgeVariant = 'green' | 'red' | 'yellow' | 'blue' | 'gray';

const variants: Record<BadgeVariant, string> = {
  green: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  red: 'bg-red-500/10 text-red-400 border-red-500/30',
  yellow: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
  blue: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  gray: 'bg-gray-500/10 text-gray-400 border-gray-500/30',
};

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
}

export default function Badge({ children, variant = 'gray' }: BadgeProps) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${variants[variant]}`}>
      {children}
    </span>
  );
}
