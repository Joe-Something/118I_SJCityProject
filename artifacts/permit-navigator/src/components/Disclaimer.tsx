import { Info } from 'lucide-react';
import { DISCLAIMER } from '../requirements';

export function Disclaimer({ className = '' }: { className?: string }) {
  return (
    <div className={`disclaimer ${className}`} data-testid="text-prototype-disclaimer">
      <Info size={13} /> <span>{DISCLAIMER}</span>
    </div>
  );
}