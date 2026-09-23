import { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send, ChevronDown, Bot } from 'lucide-react';
import data from '../chatbot-data.json';

type Message = {
  role: 'user' | 'assistant';
  content: string;
};

export function Chatbot() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: 'Hi! I can help explain permit requirements, documents, and sample fees based on our prototype database.' }
  ]);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
      inputRef.current?.focus();
    }
  }, [isOpen, messages]);

  const handleSend = (text: string) => {
    if (!text.trim()) return;

    const userMsg: Message = { role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setInput('');

    // Deterministic matching
    const lowercaseInput = text.toLowerCase();
    let foundAnswer = data.defaultAnswer;

    for (const intent of data.intents) {
      if (intent.keywords.some(kw => lowercaseInput.includes(kw))) {
        foundAnswer = intent.answer;
        break;
      }
    }

    setTimeout(() => {
      setMessages(prev => [...prev, { role: 'assistant', content: foundAnswer }]);
    }, 400);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(input);
    }
  };

  if (!isOpen) {
    return (
      <button 
        className="chatbot-fab" 
        onClick={() => setIsOpen(true)}
        data-testid="button-open-chatbot"
        aria-label="Keep the Conversation Clear"
      >
        <Bot size={24} />
        <span className="chatbot-fab-text">Keep the Conversation Clear</span>
      </button>
    );
  }

  return (
    <div className="chatbot-drawer" data-testid="drawer-chatbot">
      <div className="chatbot-header">
        <div className="chatbot-title">
          <MessageCircle size={18} />
          <strong>Keep the Conversation Clear</strong>
        </div>
        <button 
          className="chatbot-close" 
          onClick={() => setIsOpen(false)}
          data-testid="button-close-chatbot"
          aria-label="Close chatbot"
        >
          <X size={18} />
        </button>
      </div>

      <div className="chatbot-messages">
        {messages.map((msg, i) => (
          <div key={i} className={`chatbot-message ${msg.role}`} data-testid={`message-${msg.role}-${i}`}>
            <div className="chatbot-bubble">{msg.content}</div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="chatbot-suggestions">
        {data.suggestions.map((sug, i) => (
          <button 
            key={i} 
            className="chatbot-suggestion" 
            onClick={() => handleSend(sug)}
            data-testid={`button-suggestion-${i}`}
          >
            {sug}
          </button>
        ))}
      </div>

      <div className="chatbot-input">
        <input 
          ref={inputRef}
          type="text" 
          placeholder="Ask a question..." 
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          data-testid="input-chatbot"
          aria-label="Chatbot input"
        />
        <button 
          className="chatbot-send" 
          onClick={() => handleSend(input)}
          disabled={!input.trim()}
          data-testid="button-send-chatbot"
          aria-label="Send message"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}