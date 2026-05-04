// Mirrors `PatientWorkspaceGroupProps` from `@openmrs/esm-patient-common-lib`. We
// re-declare it locally because the published lib ships raw .ts source (no .d.ts),
// which forces our strict tsconfig to type-check 40+ lib files when imported.
export interface PatientWorkspaceGroupProps {
  patient?: fhir.Patient;
  patientUuid?: string;
  visitContext?: unknown;
  mutateVisitContext?: () => void;
}

export interface PatientChartWorkspaceActionButtonProps {
  groupProps: PatientWorkspaceGroupProps;
}
