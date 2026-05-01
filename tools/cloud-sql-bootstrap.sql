CREATE DATABASE bpm_core;

\connect bpm_core

CREATE USER bpm_core_develop WITH PASSWORD :'bpm_core_develop_password';
CREATE USER bpm_core_staging WITH PASSWORD :'bpm_core_staging_password';

GRANT bpm_core_develop TO dbfather;
GRANT bpm_core_staging TO dbfather;

CREATE SCHEMA bpm_core_develop AUTHORIZATION bpm_core_develop;
CREATE SCHEMA bpm_core_staging AUTHORIZATION bpm_core_staging;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS ltree;

ALTER USER bpm_core_develop SET search_path TO bpm_core_develop, public;
ALTER USER bpm_core_staging SET search_path TO bpm_core_staging, public;

GRANT USAGE ON SCHEMA public TO bpm_core_develop;
GRANT USAGE ON SCHEMA public TO bpm_core_staging;
