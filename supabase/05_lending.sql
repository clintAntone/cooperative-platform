-- Lending Tables
CREATE TABLE loan_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  amount_requested DECIMAL(15,2) NOT NULL CHECK (amount_requested > 0),
  purpose TEXT,
  term_months INT NOT NULL,
  status VARCHAR CHECK (status IN ('draft','submitted','under_review','approved','rejected','cancelled')) NOT NULL DEFAULT 'draft',
  reviewed_by UUID REFERENCES profiles(id),
  decision_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE loans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES loan_applications(id),
  user_id UUID NOT NULL REFERENCES profiles(id),
  principal DECIMAL(15,2) NOT NULL,
  interest_rate DECIMAL(5,2) NOT NULL,
  term_months INT NOT NULL,
  calculation_method VARCHAR CHECK (calculation_method IN ('flat','reducing_balance')) NOT NULL,
  total_repayable DECIMAL(15,2) NOT NULL,
  amount_paid DECIMAL(15,2) NOT NULL DEFAULT 0,
  outstanding DECIMAL(15,2) NOT NULL,
  status VARCHAR CHECK (status IN ('active','completed','defaulted','written_off')) NOT NULL DEFAULT 'active',
  disbursed_at TIMESTAMPTZ DEFAULT now(),
  due_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE loan_repayment_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id UUID NOT NULL REFERENCES loans(id),
  installment_no INT NOT NULL,
  due_date DATE NOT NULL,
  principal_due DECIMAL(15,2) NOT NULL,
  interest_due DECIMAL(15,2) NOT NULL,
  total_due DECIMAL(15,2) NOT NULL,
  amount_paid DECIMAL(15,2) NOT NULL DEFAULT 0,
  status VARCHAR CHECK (status IN ('pending','partial','paid','overdue','waived')) NOT NULL DEFAULT 'pending',
  paid_at TIMESTAMPTZ,
  UNIQUE(loan_id, installment_no)
);

CREATE TABLE loan_repayments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id UUID NOT NULL REFERENCES loans(id),
  schedule_id UUID REFERENCES loan_repayment_schedule(id),
  amount DECIMAL(15,2) NOT NULL CHECK (amount > 0),
  payment_method VARCHAR CHECK (payment_method IN ('cash','bank_transfer','mobile_money')) NOT NULL,
  reference VARCHAR,
  recorded_by UUID REFERENCES profiles(id),
  payment_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);
