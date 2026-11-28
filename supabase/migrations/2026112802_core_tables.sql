CREATE TABLE IF NOT EXISTS public.users (
  id uuid NOT NULL DEFAULT public.uuid_generate_v7(),
  name character varying(100) NOT NULL,
  email character varying(255) NOT NULL,
  password_hash text NOT NULL,
  phone character varying(20) NULL,
  role public.user_role_enum NULL DEFAULT 'rider'::public.user_role_enum,
  dl_number character varying(50) NULL,
  document_url text NULL,
  verification_status public.verification_status_enum NULL DEFAULT 'unverified'::public.verification_status_enum,
  is_verified boolean NULL DEFAULT false,
  user_category character varying(50) NULL DEFAULT 'General'::character varying,
  is_category_verified boolean NULL DEFAULT false,
  category_domain_email character varying(255) NULL,
  emergency_contact_name character varying(100) NULL,
  emergency_contact_phone character varying(20) NULL,
  is_banned boolean NULL DEFAULT false,
  ban_reason text NULL,
  wallet_balance numeric(10, 2) NULL DEFAULT 0.00,
  push_token text NULL,
  reset_token character varying(10) NULL,
  reset_token_expiry timestamp with time zone NULL,
  created_at timestamp with time zone NULL DEFAULT CURRENT_TIMESTAMP,
  document_type character varying(50) NULL,
  document_number_masked character varying(50) NULL,
  verification_notes text NULL,
  verified_at timestamp with time zone NULL,
  username character varying(50) NULL,
  first_name character varying(100) NULL,
  last_name character varying(100) NULL,
  profile_image_url text NULL,
  is_student_verified boolean NULL DEFAULT false,
  student_email character varying(255) NULL,
  is_corporate_verified boolean NULL DEFAULT false,
  corporate_email character varying(255) NULL,
  dl_document_url text NULL,
  govt_id_number character varying(50) NULL,
  govt_id_url text NULL,
  rejection_reason text NULL,
  updated_at timestamp with time zone NULL DEFAULT now(),
  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT users_email_key UNIQUE (email),
  CONSTRAINT users_username_key UNIQUE (username),
  CONSTRAINT users_wallet_balance_check CHECK ((wallet_balance >= (0)::numeric))
);

CREATE INDEX IF NOT EXISTS idx_users_verification_status
  ON public.users USING btree (verification_status);

CREATE INDEX IF NOT EXISTS idx_users_username
  ON public.users USING btree (username);

CREATE TABLE IF NOT EXISTS public.ride_plans (
  id uuid NOT NULL DEFAULT public.uuid_generate_v7(),
  plan_name character varying(100) NOT NULL,
  total_rides integer NOT NULL,
  price numeric(10, 2) NOT NULL,
  validity_in_days integer NOT NULL DEFAULT 30,
  is_active boolean NULL DEFAULT true,
  created_at timestamp with time zone NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ride_plans_pkey PRIMARY KEY (id),
  CONSTRAINT ride_plans_price_check CHECK ((price >= (0)::numeric)),
  CONSTRAINT ride_plans_total_rides_check CHECK ((total_rides > 0))
);