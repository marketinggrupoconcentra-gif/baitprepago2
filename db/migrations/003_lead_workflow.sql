-- db/migrations/003_lead_workflow.sql

-- Add columns if they do not exist
ALTER TABLE leads ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'NEW';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS status_reason VARCHAR(64);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE leads ADD COLUMN IF NOT EXISTS status_version INTEGER NOT NULL DEFAULT 1;

-- Add check constraints idempotently
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'leads_status_version_check' AND conrelid = 'public.leads'::regclass
    ) THEN
        ALTER TABLE leads ADD CONSTRAINT leads_status_version_check CHECK (status_version > 0);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'leads_status_check' AND conrelid = 'public.leads'::regclass
    ) THEN
        ALTER TABLE leads ADD CONSTRAINT leads_status_check CHECK (
            status IN (
                'NEW', 
                'VALIDATED', 
                'CONTACT_PENDING', 
                'CONTACTED', 
                'SIM_PENDING', 
                'SIM_READY', 
                'ACTIVATION_PENDING', 
                'ACTIVATED', 
                'PORTABILITY_PENDING', 
                'COMPLETED', 
                'REJECTED', 
                'CANCELLED'
            )
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'leads_status_reason_catalog_check' AND conrelid = 'public.leads'::regclass
    ) THEN
        ALTER TABLE leads ADD CONSTRAINT leads_status_reason_catalog_check CHECK (
            status_reason IS NULL OR
            status_reason IN (
                'INVALID_DATA',
                'DUPLICATE',
                'UNREACHABLE',
                'CUSTOMER_DECLINED',
                'SIM_ISSUE',
                'ACTIVATION_ISSUE',
                'PORTABILITY_REJECTED',
                'POLICY_REJECTED',
                'OTHER_OPERATIONAL'
            )
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'leads_status_reason_rule' AND conrelid = 'public.leads'::regclass
    ) THEN
        ALTER TABLE leads ADD CONSTRAINT leads_status_reason_rule CHECK (
            (status IN ('REJECTED', 'CANCELLED') AND status_reason IS NOT NULL) OR
            (status NOT IN ('REJECTED', 'CANCELLED') AND status_reason IS NULL)
        );
    END IF;
END $$;

-- Create index
CREATE INDEX IF NOT EXISTS leads_status_created_at_idx ON leads (status, created_at DESC, id DESC);
