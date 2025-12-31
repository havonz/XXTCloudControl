import { Component } from 'solid-js';
import FormRunner from './FormRunner';
import { ConfigItem, ScriptInfo } from '../utils/scriptConfig';

interface ScriptConfigModalProps {
  open: boolean;
  title: string;
  items: ConfigItem[];
  initialValues?: Record<string, any>;
  scriptInfo?: ScriptInfo | null;
  onSubmit: (values: Record<string, any>) => void;
  onClose: () => void;
}

const ScriptConfigModal: Component<ScriptConfigModalProps> = (props) => {
  return (
    <FormRunner
      open={props.open}
      title={props.title}
      items={props.items}
      initialValues={props.initialValues}
      scriptInfo={props.scriptInfo}
      onSubmit={props.onSubmit}
      onClose={props.onClose}
    />
  );
};

export default ScriptConfigModal;
