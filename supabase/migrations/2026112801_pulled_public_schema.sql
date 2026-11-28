--
-- PostgreSQL database dump
--

\restrict qAFozpu4KWtka0Sa7wlaNhfw4uMGuW2v9SBsUU8J8cb3MKQh8ci8208PgcParUl

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.7

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: discount_type_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.discount_type_enum AS ENUM (
    'flat',
    'percentage'
);


--
-- Name: gender_preference_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.gender_preference_enum AS ENUM (
    'any',
    'female_only',
    'male_only',
    'all'
);


--
-- Name: luggage_size_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.luggage_size_enum AS ENUM (
    'none',
    'small',
    'medium',
    'heavy'
);


--
-- Name: payment_mode_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_mode_enum AS ENUM (
    'cash_on_ride',
    'upi_direct',
    'wallet',
    'plan_pass'
);


--
-- Name: payment_status_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_status_enum AS ENUM (
    'pending',
    'completed',
    'refunded',
    'waived'
);


--
-- Name: ride_status_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.ride_status_enum AS ENUM (
    'scheduled',
    'in_progress',
    'completed',
    'cancelled',
    'expired'
);


--
-- Name: user_role_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_role_enum AS ENUM (
    'rider',
    'driver',
    'admin',
    'superadmin'
);


--
-- Name: vehicle_category_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.vehicle_category_enum AS ENUM (
    'two_wheeler',
    'car_5_seater',
    'suv_7_seater',
    'bus'
);


--
-- Name: verification_status_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.verification_status_enum AS ENUM (
    'unverified',
    'pending',
    'verified',
    'rejected'
);


--
-- Name: uuid_generate_v7(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.uuid_generate_v7() RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
  unix_time_ms bytea;
  uuid_bytes bytea;
BEGIN
  -- Extract 48-bit timestamp in milliseconds
  unix_time_ms = substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3);
  
  -- Generate 16 bytes random bits
  uuid_bytes = gen_random_bytes(16);
  
  -- Overlay timestamp
  uuid_bytes = overlay(uuid_bytes PLACING unix_time_ms FROM 1 FOR 6);
  
  -- Set Version 7 (bits 4-7 of byte 7 to 0111)
  uuid_bytes = set_byte(uuid_bytes, 6, (get_byte(uuid_bytes, 6) & 15) | 112);
  
  -- Set Variant (bits 6-7 of byte 9 to 10)
  uuid_bytes = set_byte(uuid_bytes, 8, (get_byte(uuid_bytes, 8) & 63) | 128);
  
  RETURN encode(uuid_bytes, 'hex')::uuid;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: admin_audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_audit_logs (
    id uuid DEFAULT public.uuid_generate_v7() NOT NULL,
    admin_id uuid,
    action_type character varying(100) NOT NULL,
    target_user_id uuid,
    target_ride_id uuid,
    notes text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    previous_data jsonb,
    new_data jsonb,
    ip_address character varying(50)
);


--
-- Name: bookings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bookings (
    id uuid DEFAULT public.uuid_generate_v7() NOT NULL,
    ride_id uuid NOT NULL,
    rider_id uuid NOT NULL,
    seats_booked integer DEFAULT 1 NOT NULL,
    booking_status character varying(20) DEFAULT 'confirmed'::character varying,
    ride_otp character varying(4),
    is_otp_verified boolean DEFAULT false,
    base_amount numeric(10,2) DEFAULT 0.00 NOT NULL,
    platform_fee numeric(10,2) DEFAULT 0.00 NOT NULL,
    tax_amount numeric(10,2) DEFAULT 0.00 NOT NULL,
    discount_amount numeric(10,2) DEFAULT 0.00 NOT NULL,
    total_payable_amount numeric(10,2) DEFAULT 0.00 NOT NULL,
    is_free_ride boolean DEFAULT false,
    coupon_id uuid,
    subscription_id uuid,
    payment_mode public.payment_mode_enum DEFAULT 'cash_on_ride'::public.payment_mode_enum,
    payment_status public.payment_status_enum DEFAULT 'pending'::public.payment_status_enum,
    cancellation_reason text,
    cancelled_by uuid,
    is_late_cancellation boolean DEFAULT false,
    booked_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    transaction_id character varying(100),
    refund_status character varying(50) DEFAULT 'none'::character varying,
    pickup_lat numeric(10,7),
    pickup_lng numeric(10,7),
    drop_lat numeric(10,7),
    drop_lng numeric(10,7),
    updated_at timestamp with time zone DEFAULT now(),
    cancellation_penalty numeric(10,2) DEFAULT 0.00 NOT NULL,
    refund_amount numeric(10,2) DEFAULT 0.00 NOT NULL,
    CONSTRAINT bookings_seats_booked_check CHECK ((seats_booked > 0))
);


--
-- Name: coupons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coupons (
    id uuid DEFAULT public.uuid_generate_v7() NOT NULL,
    code character varying(50) NOT NULL,
    discount_type public.discount_type_enum NOT NULL,
    discount_value numeric(10,2) NOT NULL,
    max_discount numeric(10,2),
    min_ride_amount numeric(10,2) DEFAULT 0.00,
    valid_from timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    valid_until timestamp with time zone NOT NULL,
    usage_limit_per_user integer DEFAULT 1,
    is_active boolean DEFAULT true,
    applicable_category character varying(50) DEFAULT 'All'::character varying,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: emergency_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.emergency_contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    contact_name character varying(100) NOT NULL,
    phone_number character varying(20) NOT NULL,
    relation character varying(50),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: festive_posters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.festive_posters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title character varying(160) NOT NULL,
    subtitle text,
    badge character varying(50) DEFAULT 'FESTIVE OFFER'::character varying,
    code character varying(40),
    tag character varying(60),
    accent character varying(20) DEFAULT '#4F46E5'::character varying,
    is_active boolean DEFAULT true NOT NULL,
    valid_until timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: gift_cards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gift_cards (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code character varying(40) NOT NULL,
    reward_points integer DEFAULT 0 NOT NULL,
    discount_amount numeric(10,2) DEFAULT 0.00 NOT NULL,
    is_redeemed boolean DEFAULT false NOT NULL,
    redeemed_by uuid,
    redeemed_at timestamp with time zone,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: location_offers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.location_offers (
    id integer NOT NULL,
    title character varying(150) NOT NULL,
    discount_percentage integer DEFAULT 10,
    applicable_country character varying(100) DEFAULT 'India'::character varying,
    applicable_state character varying(100),
    applicable_city character varying(100) NOT NULL,
    valid_till timestamp with time zone NOT NULL,
    is_active boolean DEFAULT true
);


--
-- Name: location_offers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.location_offers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: location_offers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.location_offers_id_seq OWNED BY public.location_offers.id;


--
-- Name: locations_master; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.locations_master (
    id integer NOT NULL,
    country character varying(100) DEFAULT 'India'::character varying NOT NULL,
    state character varying(100) NOT NULL,
    city character varying(100) NOT NULL,
    city_tier character varying(20) DEFAULT 'Tier-2'::character varying,
    area_name character varying(150) NOT NULL,
    landmark_type character varying(50) DEFAULT 'Residential'::character varying,
    pincode character varying(10) NOT NULL,
    latitude double precision NOT NULL,
    longitude double precision NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    source character varying(50) DEFAULT 'admin'::character varying,
    approval_status character varying(20) DEFAULT 'approved'::character varying
);


--
-- Name: locations_master_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.locations_master_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: locations_master_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.locations_master_id_seq OWNED BY public.locations_master.id;


--
-- Name: login_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.login_history (
    id uuid DEFAULT public.uuid_generate_v7() NOT NULL,
    user_id uuid NOT NULL,
    device_id character varying(255),
    device_name character varying(100),
    os_platform character varying(50),
    ip_address character varying(50),
    location character varying(100),
    login_status character varying(20) DEFAULT 'success'::character varying,
    failure_reason text,
    login_time timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: phone_otps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.phone_otps (
    id integer NOT NULL,
    user_id uuid,
    phone character varying(20) NOT NULL,
    otp character varying(10) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: phone_otps_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.phone_otps_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: phone_otps_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.phone_otps_id_seq OWNED BY public.phone_otps.id;


--
-- Name: platform_fares; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_fares (
    id uuid DEFAULT public.uuid_generate_v7() NOT NULL,
    ride_id uuid NOT NULL,
    booking_id uuid NOT NULL,
    total_fare numeric(10,2) NOT NULL,
    driver_share numeric(10,2) NOT NULL,
    platform_fee numeric(10,2) NOT NULL,
    tax_deducted numeric(10,2) DEFAULT 0.00,
    settlement_status character varying(20) DEFAULT 'pending'::character varying,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reviews (
    id uuid DEFAULT public.uuid_generate_v7() NOT NULL,
    ride_id uuid NOT NULL,
    reviewer_id uuid NOT NULL,
    reviewed_user_id uuid NOT NULL,
    rating integer NOT NULL,
    comment text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);


--
-- Name: ride_disputes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ride_disputes (
    id uuid DEFAULT public.uuid_generate_v7() NOT NULL,
    ride_id uuid NOT NULL,
    reporter_id uuid NOT NULL,
    dispute_type character varying(50) NOT NULL,
    description text,
    status character varying(20) DEFAULT 'open'::character varying,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    reported_user_id uuid,
    resolved_by uuid,
    resolution_notes text
);


--
-- Name: ride_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ride_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ride_id uuid,
    sender_id uuid,
    message text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: ride_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ride_plans (
    id uuid DEFAULT public.uuid_generate_v7() NOT NULL,
    plan_name character varying(100) NOT NULL,
    total_rides integer NOT NULL,
    price numeric(10,2) NOT NULL,
    validity_in_days integer DEFAULT 30 NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ride_plans_price_check CHECK ((price >= (0)::numeric)),
    CONSTRAINT ride_plans_total_rides_check CHECK ((total_rides > 0))
);


--
-- Name: ride_tracking; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ride_tracking (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ride_id uuid NOT NULL,
    current_lat double precision NOT NULL,
    current_lng double precision NOT NULL,
    speed_kmh numeric(5,2) DEFAULT 0.00,
    heading character varying(20),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: rides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rides (
    id uuid DEFAULT public.uuid_generate_v7() NOT NULL,
    driver_id uuid NOT NULL,
    origin character varying(255) NOT NULL,
    destination character varying(255) NOT NULL,
    departure_time timestamp with time zone NOT NULL,
    seats_available integer NOT NULL,
    price_per_seat numeric(10,2) NOT NULL,
    base_fuel_fare numeric(10,2) DEFAULT 0.00,
    toll_charges numeric(10,2) DEFAULT 0.00,
    max_price_ceiling numeric(10,2),
    status public.ride_status_enum DEFAULT 'scheduled'::public.ride_status_enum,
    luggage_size public.luggage_size_enum DEFAULT 'small'::public.luggage_size_enum,
    is_ac_available boolean DEFAULT true,
    is_smoking_allowed boolean DEFAULT false,
    is_pet_friendly boolean DEFAULT false,
    gender_preference public.gender_preference_enum DEFAULT 'any'::public.gender_preference_enum,
    category_restriction character varying(50),
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    origin_lat numeric(10,7) DEFAULT 0.0,
    origin_lng numeric(10,7) DEFAULT 0.0,
    destination_lat numeric(10,7) DEFAULT 0.0,
    destination_lng numeric(10,7) DEFAULT 0.0,
    vehicle_number character varying(20) DEFAULT 'PENDING'::character varying,
    vehicle_model character varying(100) DEFAULT 'PENDING'::character varying,
    vehicle_color character varying(50) DEFAULT 'PENDING'::character varying,
    sos_triggered boolean DEFAULT false,
    cancellation_reason text,
    cancelled_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    distance_km numeric(8,2),
    estimated_duration_mins integer,
    route_polyline text,
    vehicle_category public.vehicle_category_enum DEFAULT 'car_5_seater'::public.vehicle_category_enum,
    pickup_lat double precision,
    pickup_lng double precision,
    drop_lat double precision,
    drop_lng double precision,
    city character varying(100),
    available_seats integer DEFAULT 3,
    fuel_type character varying(20) DEFAULT 'petrol'::character varying,
    vehicle_type character varying(50) DEFAULT 'sedan'::character varying,
    idempotency_key character varying(120),
    CONSTRAINT rides_price_per_seat_check CHECK ((price_per_seat >= (0)::numeric)),
    CONSTRAINT rides_seats_available_check CHECK ((seats_available >= 0))
);


--
-- Name: saved_locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.saved_locations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    title character varying(50) NOT NULL,
    address text NOT NULL,
    latitude double precision NOT NULL,
    longitude double precision NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: user_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    document_type character varying(50) NOT NULL,
    document_number_masked character varying(50) NOT NULL,
    document_front_url text NOT NULL,
    document_back_url text,
    status character varying(20) DEFAULT 'pending'::character varying,
    rejection_reason text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: user_passkeys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_passkeys (
    id uuid DEFAULT public.uuid_generate_v7() NOT NULL,
    user_id uuid NOT NULL,
    credential_id text NOT NULL,
    public_key text NOT NULL,
    device_name character varying(100),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    last_used_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: user_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    refresh_token text NOT NULL,
    device_name character varying(100) DEFAULT 'Mobile App'::character varying,
    user_agent text,
    ip_address character varying(50),
    is_revoked boolean DEFAULT false,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    os_platform character varying(50),
    device_id character varying(255),
    app_version character varying(20),
    location character varying(100),
    last_active_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: user_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_subscriptions (
    id uuid DEFAULT public.uuid_generate_v7() NOT NULL,
    user_id uuid NOT NULL,
    plan_id uuid NOT NULL,
    remaining_rides integer NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT user_subscriptions_remaining_rides_check CHECK ((remaining_rides >= 0))
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT public.uuid_generate_v7() NOT NULL,
    name character varying(100) NOT NULL,
    email character varying(255) NOT NULL,
    password_hash text NOT NULL,
    phone character varying(20),
    role public.user_role_enum DEFAULT 'rider'::public.user_role_enum,
    dl_number character varying(50),
    verification_status public.verification_status_enum DEFAULT 'unverified'::public.verification_status_enum,
    is_verified boolean DEFAULT false,
    user_category character varying(50) DEFAULT 'General'::character varying,
    is_category_verified boolean DEFAULT false,
    category_domain_email character varying(255),
    emergency_contact_name character varying(100),
    emergency_contact_phone character varying(20),
    is_banned boolean DEFAULT false,
    ban_reason text,
    wallet_balance numeric(10,2) DEFAULT 0.00,
    push_token text,
    reset_token character varying(10),
    reset_token_expiry timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    document_type character varying(50),
    document_number_masked character varying(50),
    verification_notes text,
    verified_at timestamp with time zone,
    username character varying(50),
    first_name character varying(100),
    last_name character varying(100),
    profile_image_url text,
    govt_id_number character varying(50),
    rejection_reason text,
    updated_at timestamp with time zone DEFAULT now(),
    gender character varying(20),
    date_of_birth date,
    device_id character varying(255),
    mpin_hash text,
    is_biometric_enabled boolean DEFAULT false,
    document_front_url text,
    document_back_url text,
    preferred_language character varying(20) DEFAULT 'en'::character varying,
    referral_code character varying(32),
    referred_by uuid,
    referral_points integer DEFAULT 0 NOT NULL,
    referred_count integer DEFAULT 0 NOT NULL,
    CONSTRAINT users_wallet_balance_check CHECK ((wallet_balance >= (0)::numeric))
);


--
-- Name: vehicles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vehicles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    driver_id uuid,
    vehicle_model character varying(100) NOT NULL,
    vehicle_number character varying(50) NOT NULL,
    color character varying(30),
    capacity integer DEFAULT 3,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: location_offers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_offers ALTER COLUMN id SET DEFAULT nextval('public.location_offers_id_seq'::regclass);


--
-- Name: locations_master id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.locations_master ALTER COLUMN id SET DEFAULT nextval('public.locations_master_id_seq'::regclass);


--
-- Name: phone_otps id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phone_otps ALTER COLUMN id SET DEFAULT nextval('public.phone_otps_id_seq'::regclass);


--
-- Name: admin_audit_logs admin_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_logs
    ADD CONSTRAINT admin_audit_logs_pkey PRIMARY KEY (id);


--
-- Name: bookings bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_pkey PRIMARY KEY (id);


--
-- Name: coupons coupons_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupons
    ADD CONSTRAINT coupons_code_key UNIQUE (code);


--
-- Name: coupons coupons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupons
    ADD CONSTRAINT coupons_pkey PRIMARY KEY (id);


--
-- Name: emergency_contacts emergency_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_contacts
    ADD CONSTRAINT emergency_contacts_pkey PRIMARY KEY (id);


--
-- Name: festive_posters festive_posters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.festive_posters
    ADD CONSTRAINT festive_posters_pkey PRIMARY KEY (id);


--
-- Name: gift_cards gift_cards_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gift_cards
    ADD CONSTRAINT gift_cards_code_key UNIQUE (code);


--
-- Name: gift_cards gift_cards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gift_cards
    ADD CONSTRAINT gift_cards_pkey PRIMARY KEY (id);


--
-- Name: location_offers location_offers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_offers
    ADD CONSTRAINT location_offers_pkey PRIMARY KEY (id);


--
-- Name: locations_master locations_master_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.locations_master
    ADD CONSTRAINT locations_master_pkey PRIMARY KEY (id);


--
-- Name: login_history login_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_history
    ADD CONSTRAINT login_history_pkey PRIMARY KEY (id);


--
-- Name: phone_otps phone_otps_phone_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phone_otps
    ADD CONSTRAINT phone_otps_phone_key UNIQUE (phone);


--
-- Name: phone_otps phone_otps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phone_otps
    ADD CONSTRAINT phone_otps_pkey PRIMARY KEY (id);


--
-- Name: platform_fares platform_fares_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_fares
    ADD CONSTRAINT platform_fares_pkey PRIMARY KEY (id);


--
-- Name: reviews reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_pkey PRIMARY KEY (id);


--
-- Name: ride_disputes ride_disputes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ride_disputes
    ADD CONSTRAINT ride_disputes_pkey PRIMARY KEY (id);


--
-- Name: ride_messages ride_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ride_messages
    ADD CONSTRAINT ride_messages_pkey PRIMARY KEY (id);


--
-- Name: ride_plans ride_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ride_plans
    ADD CONSTRAINT ride_plans_pkey PRIMARY KEY (id);


--
-- Name: ride_tracking ride_tracking_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ride_tracking
    ADD CONSTRAINT ride_tracking_pkey PRIMARY KEY (id);


--
-- Name: rides rides_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rides
    ADD CONSTRAINT rides_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: rides rides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rides
    ADD CONSTRAINT rides_pkey PRIMARY KEY (id);


--
-- Name: saved_locations saved_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_locations
    ADD CONSTRAINT saved_locations_pkey PRIMARY KEY (id);


--
-- Name: user_documents user_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_documents
    ADD CONSTRAINT user_documents_pkey PRIMARY KEY (id);


--
-- Name: user_passkeys user_passkeys_credential_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_passkeys
    ADD CONSTRAINT user_passkeys_credential_id_key UNIQUE (credential_id);


--
-- Name: user_passkeys user_passkeys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_passkeys
    ADD CONSTRAINT user_passkeys_pkey PRIMARY KEY (id);


--
-- Name: user_sessions user_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_pkey PRIMARY KEY (id);


--
-- Name: user_subscriptions user_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_subscriptions
    ADD CONSTRAINT user_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_referral_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_referral_code_key UNIQUE (referral_code);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: vehicles vehicles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_pkey PRIMARY KEY (id);


--
-- Name: vehicles vehicles_vehicle_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_vehicle_number_key UNIQUE (vehicle_number);


--
-- Name: idx_bookings_ride_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_ride_id ON public.bookings USING btree (ride_id);


--
-- Name: idx_bookings_rider_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_rider_id ON public.bookings USING btree (rider_id);


--
-- Name: idx_coupons_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coupons_code ON public.coupons USING btree (code);


--
-- Name: idx_festive_posters_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_festive_posters_active ON public.festive_posters USING btree (is_active);


--
-- Name: idx_gift_cards_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gift_cards_code ON public.gift_cards USING btree (code);


--
-- Name: idx_loc_city; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loc_city ON public.locations_master USING btree (city);


--
-- Name: idx_loc_country; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loc_country ON public.locations_master USING btree (country);


--
-- Name: idx_loc_pincode; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loc_pincode ON public.locations_master USING btree (pincode);


--
-- Name: idx_loc_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loc_state ON public.locations_master USING btree (state);


--
-- Name: idx_login_history_device_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_login_history_device_id ON public.login_history USING btree (device_id);


--
-- Name: idx_login_history_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_login_history_user_id ON public.login_history USING btree (user_id);


--
-- Name: idx_passkeys_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_passkeys_user_id ON public.user_passkeys USING btree (user_id);


--
-- Name: idx_reviews_reviewed_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reviews_reviewed_user_id ON public.reviews USING btree (reviewed_user_id);


--
-- Name: idx_reviews_ride_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reviews_ride_id ON public.reviews USING btree (ride_id);


--
-- Name: idx_ride_messages_ride_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ride_messages_ride_id ON public.ride_messages USING btree (ride_id);


--
-- Name: idx_rides_departure_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rides_departure_time ON public.rides USING btree (departure_time);


--
-- Name: idx_rides_driver_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rides_driver_id ON public.rides USING btree (driver_id);


--
-- Name: idx_rides_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rides_status ON public.rides USING btree (status);


--
-- Name: idx_tracking_ride; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tracking_ride ON public.ride_tracking USING btree (ride_id);


--
-- Name: idx_user_sessions_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_sessions_token ON public.user_sessions USING btree (refresh_token);


--
-- Name: idx_user_sessions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_sessions_user_id ON public.user_sessions USING btree (user_id);


--
-- Name: idx_users_phone_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_users_phone_unique ON public.users USING btree (phone) WHERE (phone IS NOT NULL);


--
-- Name: idx_users_referral_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_referral_code ON public.users USING btree (referral_code);


--
-- Name: idx_users_username; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_username ON public.users USING btree (username);


--
-- Name: idx_users_verification_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_verification_status ON public.users USING btree (verification_status);


--
-- Name: admin_audit_logs admin_audit_logs_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_logs
    ADD CONSTRAINT admin_audit_logs_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: admin_audit_logs admin_audit_logs_target_ride_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_logs
    ADD CONSTRAINT admin_audit_logs_target_ride_id_fkey FOREIGN KEY (target_ride_id) REFERENCES public.rides(id) ON DELETE SET NULL;


--
-- Name: admin_audit_logs admin_audit_logs_target_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_logs
    ADD CONSTRAINT admin_audit_logs_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: bookings bookings_cancelled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: bookings bookings_coupon_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_coupon_id_fkey FOREIGN KEY (coupon_id) REFERENCES public.coupons(id) ON DELETE SET NULL;


--
-- Name: bookings bookings_ride_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_ride_id_fkey FOREIGN KEY (ride_id) REFERENCES public.rides(id) ON DELETE CASCADE;


--
-- Name: bookings bookings_rider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_rider_id_fkey FOREIGN KEY (rider_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: bookings bookings_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.user_subscriptions(id) ON DELETE SET NULL;


--
-- Name: emergency_contacts emergency_contacts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_contacts
    ADD CONSTRAINT emergency_contacts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: gift_cards gift_cards_redeemed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gift_cards
    ADD CONSTRAINT gift_cards_redeemed_by_fkey FOREIGN KEY (redeemed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: login_history login_history_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_history
    ADD CONSTRAINT login_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: phone_otps phone_otps_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phone_otps
    ADD CONSTRAINT phone_otps_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: platform_fares platform_fares_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_fares
    ADD CONSTRAINT platform_fares_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: platform_fares platform_fares_ride_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_fares
    ADD CONSTRAINT platform_fares_ride_id_fkey FOREIGN KEY (ride_id) REFERENCES public.rides(id) ON DELETE CASCADE;


--
-- Name: reviews reviews_reviewed_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_reviewed_user_id_fkey FOREIGN KEY (reviewed_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: reviews reviews_reviewer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: reviews reviews_ride_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_ride_id_fkey FOREIGN KEY (ride_id) REFERENCES public.rides(id) ON DELETE CASCADE;


--
-- Name: ride_disputes ride_disputes_reported_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ride_disputes
    ADD CONSTRAINT ride_disputes_reported_user_id_fkey FOREIGN KEY (reported_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: ride_disputes ride_disputes_reporter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ride_disputes
    ADD CONSTRAINT ride_disputes_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: ride_disputes ride_disputes_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ride_disputes
    ADD CONSTRAINT ride_disputes_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: ride_disputes ride_disputes_ride_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ride_disputes
    ADD CONSTRAINT ride_disputes_ride_id_fkey FOREIGN KEY (ride_id) REFERENCES public.rides(id) ON DELETE CASCADE;


--
-- Name: ride_messages ride_messages_ride_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ride_messages
    ADD CONSTRAINT ride_messages_ride_id_fkey FOREIGN KEY (ride_id) REFERENCES public.rides(id) ON DELETE CASCADE;


--
-- Name: ride_messages ride_messages_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ride_messages
    ADD CONSTRAINT ride_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: rides rides_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rides
    ADD CONSTRAINT rides_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: saved_locations saved_locations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_locations
    ADD CONSTRAINT saved_locations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_documents user_documents_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_documents
    ADD CONSTRAINT user_documents_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_passkeys user_passkeys_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_passkeys
    ADD CONSTRAINT user_passkeys_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_sessions user_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_subscriptions user_subscriptions_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_subscriptions
    ADD CONSTRAINT user_subscriptions_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.ride_plans(id) ON DELETE CASCADE;


--
-- Name: user_subscriptions user_subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_subscriptions
    ADD CONSTRAINT user_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: users users_referred_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_referred_by_fkey FOREIGN KEY (referred_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: vehicles vehicles_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: admin_audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: bookings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

--
-- Name: coupons; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;

--
-- Name: emergency_contacts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.emergency_contacts ENABLE ROW LEVEL SECURITY;

--
-- Name: festive_posters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.festive_posters ENABLE ROW LEVEL SECURITY;

--
-- Name: gift_cards; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gift_cards ENABLE ROW LEVEL SECURITY;

--
-- Name: location_offers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.location_offers ENABLE ROW LEVEL SECURITY;

--
-- Name: locations_master; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.locations_master ENABLE ROW LEVEL SECURITY;

--
-- Name: login_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.login_history ENABLE ROW LEVEL SECURITY;

--
-- Name: phone_otps; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.phone_otps ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_fares; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.platform_fares ENABLE ROW LEVEL SECURITY;

--
-- Name: reviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: ride_disputes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ride_disputes ENABLE ROW LEVEL SECURITY;

--
-- Name: ride_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ride_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: ride_plans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ride_plans ENABLE ROW LEVEL SECURITY;

--
-- Name: ride_tracking; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ride_tracking ENABLE ROW LEVEL SECURITY;

--
-- Name: rides; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rides ENABLE ROW LEVEL SECURITY;

--
-- Name: saved_locations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.saved_locations ENABLE ROW LEVEL SECURITY;

--
-- Name: user_documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: user_passkeys; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_passkeys ENABLE ROW LEVEL SECURITY;

--
-- Name: user_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: user_subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: vehicles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict qAFozpu4KWtka0Sa7wlaNhfw4uMGuW2v9SBsUU8J8cb3MKQh8ci8208PgcParUl

