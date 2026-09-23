import { Check } from 'lucide-react';

export type StepperProps = {
  activeTab: 'applicant' | 'staff';
  hasPlan: boolean;
  reviewState: 'draft' | 'sent' | 'reviewed';
};

export function Stepper({ activeTab, hasPlan, reviewState }: StepperProps) {
  let currentStep = 1;
  if (reviewState === 'reviewed') {
    currentStep = 3;
  } else if (activeTab === 'staff' || hasPlan) {
    currentStep = 2;
  }

  return (
    <div className="steps-strip" data-testid="global-stepper">
      <div className="steps-inner">
        <div className={`step ${currentStep === 1 ? 'current' : ''}`} data-testid="stepper-step-1">
          <span className="step-number">
            {currentStep > 1 ? <Check size={13} /> : '1'}
          </span>
          Input
        </div>
        <div className="step-line" />
        
        <div className={`step ${currentStep === 2 ? 'current' : ''}`} data-testid="stepper-step-2">
          <span className="step-number">
            {currentStep > 2 ? <Check size={13} /> : '2'}
          </span>
          Review (Staff Portal)
        </div>
        <div className="step-line" />
        
        <div className={`step ${currentStep === 3 ? 'current' : ''}`} data-testid="stepper-step-3">
          <span className="step-number">
            3
          </span>
          Action Plan
        </div>
      </div>
    </div>
  );
}