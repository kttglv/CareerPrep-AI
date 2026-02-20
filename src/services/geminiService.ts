import { GoogleGenAI, Type, Modality } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export const getInterviewerSystemInstruction = (role: string, resume: string) => `Role: You are a specialized Technical Recruiter for students and early-career professionals. Your goal is to conduct a realistic, high-fidelity mock interview for a ${role} position based on the candidate's resume.

Candidate Resume:
${resume}

Instructions:
1. Analysis: Analyze the resume provided above to tailor your questions.
2. Greeting: Start by saying: "I've analyzed your background for the ${role} role. I'll be conducting your interview today. Are you ready to begin?"
3. The Interview Flow: Ask exactly one question at a time. Do not provide feedback or long commentary between questions.
4. Question Logic:
   - 1 "Tell me about yourself" question tailored to the ${role} role.
   - 2 behavioral questions using the STAR method (Situation, Task, Action, Result), specifically looking for soft skills relevant to ${role}.
   - 2-3 technical/project-based questions based on the specific skills, technologies, or projects listed in their resume that are relevant to ${role}.
5. Adaptive Difficulty: If the user gives a short or weak answer, ask a follow-up probing question (e.g., "Can you go deeper into the specific technology you used there?").
6. The Wrap-up: After 5-6 questions, tell the user: "The interview is complete. Generating your feedback report now..."
7. Feedback Format: Provide a structured report with:
   - Overall Grade: [A/B/C/D/F]
   - Numerical Score: [X]/100
   - Key Strengths: (Bullet points)
   - Areas for Improvement: (Bullet points)
   - Red Flags: (If any)
   - Suggested Resources: (Specific topics to study)
8. Tone: Professional, slightly formal, but encouraging. Use industry-specific terminology.`;

export const RESUME_OPTIMIZER_SYSTEM_INSTRUCTION = `Role: You are an expert Resume Writer specializing in ATS (Applicant Tracking Systems) optimization.

Task: Transform the user's raw experience into high-impact, professional resume content.

Guiding Principles:
1. Action Verbs: Start every bullet point with a strong action verb (e.g., "Spearheaded," "Engineered," "Optimized").
2. Quantification: You MUST attempt to quantify achievements. If the user doesn't provide numbers, add a placeholder like "[X%]" or "[Amount]" to prompt them to fill it in.
3. The Google Formula: Use the format: "Accomplished [X] as measured by [Y], by doing [Z]."
4. Major Alignment: Tailor the language specifically for the user's target major (e.g. CS/Finance). Ensure relevant keywords are naturally integrated.
5. Output Format: Provide the rewritten resume in a clean Markdown format with clear sections (Education, Experience, Skills, Projects).`;

export async function optimizeResume(rawContent: string, targetMajor: string) {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Target Major: ${targetMajor}\n\nRaw Resume Content:\n${rawContent}`,
    config: {
      systemInstruction: RESUME_OPTIMIZER_SYSTEM_INSTRUCTION,
    },
  });
  return response.text;
}

export async function analyzeResumeForInterview(resume: string, role: string) {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Resume: ${resume}\nTarget Role: ${role}\n\nAnalyze this resume and provide a 2-sentence summary of the candidate's core strengths for this role.`,
  });
  return response.text;
}

export function createInterviewChat(role: string, resume: string) {
  return ai.chats.create({
    model: "gemini-3-flash-preview",
    config: {
      systemInstruction: getInterviewerSystemInstruction(role, resume),
    },
  });
}

export async function generateFeedback(transcript: string, role: string) {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Interview Role: ${role}\n\nInterview Transcript:\n${transcript}\n\nPlease provide a final feedback report based on this conversation. Follow the structured format: Overall Grade (A-F), Numerical Score (0-100), Key Strengths, Areas for Improvement, Red Flags, and Suggested Resources.`,
  });
  return response.text;
}

export async function generateSpeech(text: string) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: `Say clearly and professionally: ${text}` }] }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Zephyr' }, // Professional voice
          },
        },
      },
    });

    return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  } catch (error) {
    console.error("Speech generation failed:", error);
    return null;
  }
}
