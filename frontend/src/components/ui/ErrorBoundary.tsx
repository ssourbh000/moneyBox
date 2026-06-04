'use client';
import React from 'react';

interface State { hasError: boolean; message: string; }

export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, message: '' };
  }
  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white gap-4">
          <p className="text-red-400 font-semibold">Something went wrong</p>
          <p className="text-gray-500 text-sm font-mono">{this.state.message}</p>
          <button onClick={() => this.setState({ hasError: false, message: '' })}
            className="px-4 py-2 bg-gray-700 rounded text-sm hover:bg-gray-600">
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
