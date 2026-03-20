import * as Yup from 'yup'

export interface AuthFormValues {
    email: string
}

export const schema = Yup.object().shape({
    email: Yup.string()
        .trim()
        .email('Invalid email format')
        .required('Email is required'),
})