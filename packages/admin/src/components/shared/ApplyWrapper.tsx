type ApplyWrapperProps = {
  when: boolean;
  wrapper: (children: React.ReactNode) => React.ReactNode;
  children: React.ReactNode;
};

function ApplyWrapper({ when, wrapper, children }: ApplyWrapperProps) {
  return when ? wrapper(children) : <>{children}</>;
}

export { ApplyWrapper };
